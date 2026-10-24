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
    config
        .build()
        .and_then(|p| {
            p.to_svg(&ColorImage {
                pixels: rgba,
                width,
                height,
            })
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
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
    if cutout {
        config.hierarchical = vtracer::Hierarchical::Cutout;
    }
    if watershed {
        config.clustering = vtracer::Clustering::Watershed;
    }
    config
        .build()
        .and_then(|p| {
            p.to_svg(&ColorImage {
                pixels: rgba,
                width,
                height,
            })
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
