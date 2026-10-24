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
            config.color_precision = 6;
            config.max_colors = Some(8);
            config.filter_speckle = 2;
            config.mode = FitMode::Polygon;
        }
        "illustration" => {
            config.color_precision = 7;
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
