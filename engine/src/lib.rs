use vtracer::{ColorImage, Config, FitMode};
use wasm_bindgen::prelude::*;

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
thread_local! { static LAST_TIMING: std::cell::Cell<(f64,f64)> = const {std::cell::Cell::new((0.0,0.0))}; }
#[wasm_bindgen]
pub fn last_stage_timings() -> Vec<f64> {
    LAST_TIMING.with(|t| {
        let (a, b) = t.get();
        vec![a, b]
    })
}

fn run_pipeline(
    config: Config,
    rgba: Vec<u8>,
    width: usize,
    height: usize,
    profile: &str,
) -> Result<String, JsValue> {
    let mut pipeline = config
        .build()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    if profile == "adaptive" {
        pipeline.compositing = vtracer::compose::Compositing::Stacked(Box::new(RegionFitter {
            polygon: matches!(config.mode, FitMode::Polygon),
            max_side: width.min(height),
        }));
    }
    let img = ColorImage {
        pixels: rgba,
        width,
        height,
    };
    let start = now();
    let mut segmented = start;
    let doc = pipeline
        .run_with_progress(&img, &vtracer::CancelToken::new(), &mut |p| {
            if p.phase == vtracer::Phase::Segment && p.fraction >= 1.0 {
                segmented = now();
            }
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let svg = pipeline.writer.write(&doc);
    LAST_TIMING.with(|t| t.set((segmented - start, now() - segmented)));
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
    if !["adaptive", "shared", "legacy", "blend"].contains(&profile) {
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
    if profile == "shared" || profile == "blend" {
        config.hierarchical = vtracer::Hierarchical::Cutout;
        config.mode = FitMode::Spline;
        config.corner_threshold = 90;
        config.length_threshold = 2.0;
        config.simplify = Some(0.25);
        if profile == "blend" {
            config.clustering = vtracer::Clustering::Watershed;
            config.watershed_detail = 96;
        }
    }
    run_pipeline(config, rgba, width, height, profile)
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

// Selects upstream fitters; no contours or curves are generated here.
struct RegionFitter {
    polygon: bool,
    max_side: usize,
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
            output.extend(self.fit_component(&component));
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
