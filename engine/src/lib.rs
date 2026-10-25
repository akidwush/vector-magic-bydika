mod alpha;
mod corners;
mod coverage;
mod planar;
mod reduce;
mod source_fit;
#[wasm_bindgen]
pub fn last_optimization() -> Vec<f64> {
    reduce::values()
}
#[wasm_bindgen]
pub fn last_corner_evidence() -> Vec<f64> {
    corners::evidence()
}
use vtracer::{ColorImage, Config, FitMode};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn last_source_models() -> u32 {
    source_fit::accepted()
}

/// Thin integration only; segmentation and curve fitting are upstream VTracer.
#[wasm_bindgen]
pub fn trace(rgba: Vec<u8>, width: usize, height: usize, preset: &str) -> Result<String, JsValue> {
    if width == 0
        || height == 0
        || width
            .checked_mul(height)
            .filter(|n| *n <= 2_000_000)
            .and_then(|n| n.checked_mul(4))
            != Some(rgba.len())
    {
        return Err(JsValue::from_str(
            "Invalid RGBA dimensions or tracing limit exceeded",
        ));
    }
    let mut config = Config::default();
    match preset {
        "logo" => {
            config.color_precision = precision_for(&rgba, preset);
            config.max_colors = Some(8);
            config.filter_speckle = 2;
            config.mode = FitMode::Polygon;
        }
        "illustration" => {
            config.color_precision = precision_for(&rgba, preset);
            config.max_colors = Some(24);
            config.filter_speckle = 2;
        }
        "photo" => {
            config.color_precision = 8;
            config.max_colors = Some(64);
            config.filter_speckle = 4;
            config.layer_difference = 24;
        }
        _ => return Err(JsValue::from_str("Unsupported preset")),
    }
    run_pipeline(config, rgba, width, height, "legacy")
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn now() -> f64;
}
thread_local! {static LAST_COVERAGE:std::cell::Cell<[u32;4]>=const {std::cell::Cell::new([0;4])};}
#[wasm_bindgen]
pub fn last_coverage_evidence() -> Vec<u32> {
    LAST_COVERAGE.with(|s| s.get().to_vec())
}
thread_local! { static LAST_TIMING: std::cell::Cell<[f64;7]> = const {std::cell::Cell::new([0.0;7])}; }
#[wasm_bindgen]
pub fn last_stage_timings() -> Vec<f64> {
    LAST_TIMING.with(|t| t.get().to_vec())
}
thread_local! {static LAST_TOPOLOGY:std::cell::RefCell<Vec<f64>>=const {std::cell::RefCell::new(Vec::new())};}
#[wasm_bindgen]
pub fn last_topology() -> Vec<f64> {
    LAST_TOPOLOGY.with(|s| s.borrow().clone())
}

fn run_pipeline(
    mut config: Config,
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    profile: &str,
) -> Result<String, JsValue> {
    let optimize = profile.starts_with("reduce-");
    let profile = profile.strip_prefix("reduce-").unwrap_or(profile);
    reduce::reset();
    let img = std::sync::Arc::new(ColorImage {
        pixels: rgba,
        width,
        height,
    });
    source_fit::reset();
    source_fit::sparse(optimize);
    let prepare_started = now();
    let source_prepared = if profile.starts_with("reconstruct") {
        source_fit::prepare(&img).0
    } else {
        None
    };
    let profile = if profile.starts_with("reconstruct") {
        if profile == "reconstruct-planar" {
            "intelligent"
        } else if profile == "reconstruct-blend" && source_prepared.is_none() {
            config.hierarchical = vtracer::Hierarchical::Cutout;
            config.clustering = vtracer::Clustering::Watershed;
            config.mode = FitMode::Spline;
            config.corner_threshold = 90;
            config.length_threshold = 2.;
            config.simplify = Some(0.25);
            config.watershed_detail = 96;
            "source-blend"
        } else {
            "source"
        }
    } else {
        profile
    };
    let preparation_ms = now() - prepare_started;
    let mut pipeline = config
        .build()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    if profile == "source"
        || profile == "adaptive"
        || profile == "coverage"
        || profile == "alpha"
        || profile.ends_with("-adaptive")
    {
        pipeline.compositing = vtracer::compose::Compositing::Stacked(Box::new(RegionFitter {
            polygon: matches!(config.mode, FitMode::Polygon),
            max_side: width.min(height),
            source: if profile == "source" {
                Some(img.clone())
            } else {
                None
            },
        }));
    }
    let start = now();
    let (prepared, _) = if cfg!(feature = "experiments") && profile.starts_with("coverage-clean-") {
        coverage::prepare(&img)
    } else {
        (None, 0)
    };
    let mut segmented = start;
    LAST_TOPOLOGY.with(|s| s.borrow_mut().clear());
    corners::reset();
    let mut source_map = None;
    let mut doc = if profile == "source-blend" {
        let mut seg = pipeline
            .segment(source_prepared.as_ref().unwrap_or(&img))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        segmented = now();
        for fitter in &pipeline.color_fitters {
            fitter.fit(&mut seg);
        }
        let mut map = vtracer::mosaic::LabelMap::from_segmentation(&seg);
        let merge_diff = match &pipeline.compositing {
            vtracer::compose::Compositing::Mosaic { merge_diff, .. } => *merge_diff,
            _ => 0,
        };
        map.merge_similar(merge_diff);
        source_map = Some(map);
        let mut doc = pipeline.compositing.compose(&seg, &pipeline.curve_passes);
        for pass in &pipeline.optimizers {
            pass.run(&mut doc);
        }
        doc
    } else if profile == "planar" || profile == "intelligent" {
        let mut seg = pipeline
            .segment(source_prepared.as_ref().unwrap_or(&img))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        segmented = now();
        for fitter in &pipeline.color_fitters {
            fitter.fit(&mut seg);
        }
        let (doc, stats) =
            planar::compose_optimized(&seg, profile == "intelligent", Some(&img), optimize)
                .map_err(|e| JsValue::from_str(&e))?;
        LAST_TOPOLOGY.with(|s| *s.borrow_mut() = stats.values());
        // Absolute, pre-quantized shared coordinates. No per-face optimizer pass.
        pipeline.writer.relative = false;
        pipeline.writer.shorthands = false;
        pipeline.writer.precision = Some(6);
        doc
    } else {
        pipeline
            .run_with_progress(
                source_prepared
                    .as_ref()
                    .or(prepared.as_ref())
                    .unwrap_or(&img),
                &vtracer::CancelToken::new(),
                &mut |p| {
                    if p.phase == vtracer::Phase::Segment && p.fraction >= 1.0 {
                        segmented = now();
                    }
                },
            )
            .map_err(|e| JsValue::from_str(&e.to_string()))?
    };
    let fitted_at = now();
    let mut evidence = coverage::Evidence::default();
    if profile == "source" {
        evidence = coverage::refine_except(&mut doc, &img, &source_fit::protected());
    } else if profile.starts_with("coverage") || profile == "source-blend" {
        evidence = coverage::refine(&mut doc, &img);
    }
    if let Some(map) = source_map {
        source_fit::refine_mosaic(&mut doc, &map, &img);
        if source_fit::accepted() > 0 {
            pipeline.writer.precision = Some(6);
        }
    }
    LAST_COVERAGE.with(|s| {
        s.set([
            evidence.accepted as u32,
            evidence.rejected as u32,
            evidence.srgb as u32,
            evidence.linear as u32,
        ])
    });
    if optimize {
        // Check the compositor itself: aliases such as coverage-blend also own
        // shared boundaries and must never enter a per-face fitting pass.
        if profile != "planar"
            && profile != "intelligent"
            && matches!(
                &pipeline.compositing,
                vtracer::compose::Compositing::Stacked(_)
            )
        {
            use vtracer::optimize::OptimizerPass;
            vtracer::optimize::QuantizePass::new(2).run(&mut doc);
            reduce::document(&mut doc);
            pipeline.writer.precision = Some(6);
        }
        // Upstream Mosaic gets only exact line canonicalization. Retain its
        // original writer precision; locked graph precision is already six.
        reduce::serialize_lines(&mut doc);
    }
    let refined_at = now();
    let mut svg = pipeline.writer.write(&doc);
    let exported_at = now();
    if profile.starts_with("coverage")
        || profile == "alpha"
        || profile == "planar"
        || profile == "intelligent"
        || profile == "source"
        || profile == "source-blend"
    {
        svg = alpha::apply(svg, &img).map_err(|e| JsValue::from_str(&e.to_string()))?;
    }
    LAST_TIMING.with(|t| {
        t.set([
            segmented - start,
            now() - segmented,
            refined_at - fitted_at,
            now() - exported_at,
            exported_at - refined_at,
            preparation_ms,
            fitted_at - segmented,
        ])
    });
    Ok(svg)
}

#[wasm_bindgen]
pub fn trace_quality(
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    preset: &str,
    profile: &str,
) -> Result<String, JsValue> {
    if width == 0
        || height == 0
        || width
            .checked_mul(height)
            .filter(|n| *n <= 2_000_000)
            .and_then(|n| n.checked_mul(4))
            != Some(rgba.len())
    {
        return Err(JsValue::from_str("Invalid RGBA dimensions"));
    }
    let requested_profile = profile;
    let profile = profile.strip_prefix("reduce-").unwrap_or(profile);
    if profile.starts_with("coverage-clean-") && !cfg!(feature = "experiments") {
        return Err(JsValue::from_str(
            "Pre-segmentation labeling is research-only",
        ));
    }
    let base = profile
        .strip_prefix("coverage-clean-")
        .or_else(|| profile.strip_prefix("coverage-"))
        .unwrap_or(profile);
    if ![
        "adaptive",
        "shared",
        "legacy",
        "blend",
        "coverage",
        "alpha",
        "planar",
        "intelligent",
        "source",
        "source-blend",
        "reconstruct",
        "reconstruct-blend",
        "reconstruct-planar",
    ]
    .contains(&base)
    {
        return Err(JsValue::from_str("Invalid quality profile"));
    }
    let mut config = Config::default();
    config.color_precision = precision_for(&rgba, preset);
    match preset {
        "logo" => {
            config.max_colors = Some(8);
            config.filter_speckle = 2;
            config.mode = FitMode::Polygon;
        }
        "illustration" => {
            config.max_colors = Some(24);
            config.filter_speckle = 2;
        }
        "photo" => {
            config.color_precision = 8;
            config.max_colors = Some(64);
            config.filter_speckle = 4;
            config.layer_difference = 24;
        }
        _ => return Err(JsValue::from_str("Invalid preset")),
    }
    if base == "shared" || base == "blend" || base == "source-blend" {
        config.hierarchical = vtracer::Hierarchical::Cutout;
        config.mode = FitMode::Spline;
        config.corner_threshold = 90;
        config.length_threshold = 2.0;
        config.simplify = Some(0.25);
        if base == "blend" || base == "source-blend" {
            config.clustering = vtracer::Clustering::Watershed;
            config.watershed_detail = 96;
        }
    }
    run_pipeline(config, rgba, width, height, requested_profile)
}

/// Conservative flat-color statistic: at least 85% of pixels in eight RGB bins.
/// This selects upstream clustering precision, never changes pixels or alpha.
#[wasm_bindgen]
pub fn precision_for(rgba: &[u8], preset: &str) -> i32 {
    if preset == "photo" {
        return 8;
    }
    let mut bins = [0usize; 4096];
    for p in rgba.chunks_exact(4) {
        let key = ((p[0] as usize >> 4) << 8) | ((p[1] as usize >> 4) << 4) | (p[2] as usize >> 4);
        bins[key] += 1;
    }
    bins.sort_unstable();
    if bins[4088..].iter().sum::<usize>() * 100 >= rgba.len() / 4 * 85 {
        5
    } else if preset == "logo" {
        6
    } else {
        7
    }
}

// Research-only binding: absent from production builds. No vendor algorithm changes.
#[cfg(feature = "experiments")]
#[wasm_bindgen]
pub fn experiment(
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    precision: i32,
    speckle: usize,
    layer: i32,
    colors: usize,
    mode: &str,
    cutout: bool,
    watershed: bool,
    corner: i32,
    length: f64,
    simplify: Option<f64>,
    watershed_detail: Option<u32>,
    adaptive: Option<bool>,
) -> Result<String, JsValue> {
    if width == 0 || height == 0 || width * height > 2_000_000 || rgba.len() != width * height * 4 {
        return Err(JsValue::from_str("Invalid experiment input"));
    }
    let mut config = Config::default();
    config.color_precision = precision;
    config.filter_speckle = speckle;
    config.layer_difference = layer;
    config.max_colors = if colors == 0 { None } else { Some(colors) };
    config.mode = mode.parse().map_err(|e: String| JsValue::from_str(&e))?;
    config.corner_threshold = corner;
    config.length_threshold = length;
    config.simplify = simplify;
    if let Some(detail) = watershed_detail {
        config.watershed_detail = detail;
    }
    if cutout {
        config.hierarchical = vtracer::Hierarchical::Cutout;
    }
    if watershed {
        config.clustering = vtracer::Clustering::Watershed;
    }
    config
        .build()
        .and_then(|mut p| {
            if adaptive == Some(true) {
                p.compositing = vtracer::compose::Compositing::Stacked(Box::new(RegionFitter {
                    polygon: mode == "polygon",
                    max_side: width.min(height),
                    source: None,
                }));
            }
            p.to_svg(&ColorImage {
                pixels: rgba,
                width,
                height,
            })
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

// Upstream contour extraction and baseline fitting; optional source-verified model refinement.
struct RegionFitter {
    polygon: bool,
    max_side: usize,
    source: Option<std::sync::Arc<ColorImage>>,
}
impl vtracer::fitter::CurveFitter for RegionFitter {
    fn fit_region(&self, mask: &vtracer::ir::RegionMask) -> Vec<vtracer::fitter::FittedGeom> {
        let mut output = Vec::new();
        for cluster in mask.image.to_clusters(false).iter() {
            let component = vtracer::ir::RegionMask::new(
                cluster.to_binary_image(),
                vtracer::PointI32 {
                    x: mask.offset.x + cluster.rect.left,
                    y: mask.offset.y + cluster.rect.top,
                },
            );
            let baseline = self.fit_component(&component);
            output.extend(if let Some(img) = &self.source {
                source_fit::optimize(&component, img, baseline)
            } else {
                baseline
            });
        }
        output
    }
}
impl RegionFitter {
    fn fit_component(&self, mask: &vtracer::ir::RegionMask) -> Vec<vtracer::fitter::FittedGeom> {
        use vtracer::fitter::{CurveFitter, FitParams, PolygonFitter, SplineFitter};
        let (w, h) = (mask.width(), mask.height());
        let mut round = w >= 4
            && h >= 4
            && w <= self.max_side
            && h <= self.max_side
            && w as f64 / h as f64 >= 0.5
            && w as f64 / h as f64 <= 2.0;
        if round {
            let mut intersection = 0usize;
            let mut union = 0usize;
            for y in 0..h {
                for x in 0..w {
                    let expected = ((x as f64 + 0.5 - w as f64 / 2.0) / (w as f64 / 2.0)).powi(2)
                        + ((y as f64 + 0.5 - h as f64 / 2.0) / (h as f64 / 2.0)).powi(2)
                        <= 1.0;
                    let actual = mask.image.get_pixel(x, y);
                    if expected && actual {
                        intersection += 1;
                    }
                    if expected || actual {
                        union += 1;
                    }
                }
            }
            round = intersection as f64 / union.max(1) as f64 >= 0.94;
        }
        if self.source.is_some() && !round {
            if let Some(polygon) = source_fit::polygonal(mask, self.source.as_ref().unwrap()) {
                return polygon;
            }
        }
        if round {
            SplineFitter::new(FitParams {
                corner_threshold: std::f64::consts::FRAC_PI_2,
                ..FitParams::default()
            })
            .fit_region(mask)
        } else if self.polygon {
            PolygonFitter.fit_region(mask)
        } else {
            SplineFitter::default().fit_region(mask)
        }
    }
}

#[cfg(feature = "experiments")]
#[wasm_bindgen]
pub fn alpha_experiment(
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    preset: &str,
    mode: u8,
) -> Result<String, JsValue> {
    let svg = trace_quality(rgba.clone(), width, height, preset, "adaptive")?;
    let image = ColorImage {
        pixels: rgba,
        width,
        height,
    };
    alpha::apply_with_mode(
        svg,
        &image,
        match mode {
            1 => FitMode::Polygon,
            2 => FitMode::Pixel,
            _ => FitMode::Spline,
        },
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}
