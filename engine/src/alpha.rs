//! Vector-only opacity reconstruction using upstream binary contours at fixed levels.
use vtracer::{Clustering, ColorImage, Config, FitMode};
fn body(svg: &str) -> &str {
    let start = svg.find("<svg").unwrap();
    let open = svg[start..].find('>').unwrap() + start + 1;
    &svg[open..svg.rfind("</svg>").unwrap()]
}
pub fn apply(svg: String, img: &ColorImage) -> Result<String, vtracer::Error> {
    apply_with_mode(svg, img, FitMode::Polygon)
}
pub fn apply_with_mode(
    svg: String,
    img: &ColorImage,
    mode: FitMode,
) -> Result<String, vtracer::Error> {
    if !img.pixels.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255) {
        return Ok(svg);
    }
    // Bound aggregate level-set edge complexity before allocating contour graphs.
    let band = |a: u8| {
        if a == 255 {
            9i32
        } else if a == 0 {
            0
        } else {
            1 + (a as i32 / 32)
        }
    };
    let mut transitions = 0usize;
    for y in 0..img.height {
        for x in 0..img.width {
            let i = (y * img.width + x) * 4;
            let a = band(img.pixels[i + 3]);
            if x > 0 {
                transitions += (a - band(img.pixels[i - 1])).unsigned_abs() as usize;
            }
            if y > 0 {
                transitions +=
                    (a - band(img.pixels[i - img.width * 4 + 3])).unsigned_abs() as usize;
            }
            if transitions > 65536 {
                return Err(vtracer::Error::Other("Alpha contour budget exceeded; use a smaller input or explicitly select the previous unsupported-alpha profile".into()));
            }
        }
    }
    let mut grayscale = vec![0u8; img.pixels.len()];
    for (i, p) in img.pixels.chunks_exact(4).enumerate() {
        let value = 255 - p[3];
        grayscale[i * 4..i * 4 + 4].copy_from_slice(&[value, value, value, 255]);
    }
    let alpha = ColorImage {
        pixels: grayscale,
        width: img.width,
        height: img.height,
    };
    let mut masks = String::new();
    let mut previous = 0.0;
    // Scalar coverage quantization <=16/255 before contour-fit/rasterization error.
    // A band starts exactly at alpha=128; reconstructed contour accuracy is measured.
    for (threshold, opacity) in [
        (1, 16.0 / 255.0),
        (32, 48.0 / 255.0),
        (64, 80.0 / 255.0),
        (96, 112.0 / 255.0),
        (128, 144.0 / 255.0),
        (160, 176.0 / 255.0),
        (192, 208.0 / 255.0),
        (224, 240.0 / 255.0),
        (255, 1.0),
    ] {
        let mut config = Config::default();
        config.clustering = Clustering::Binary;
        config.binary_threshold = (256 - threshold) as u8;
        config.filter_speckle = 0;
        config.mode = mode;
        config.corner_threshold = 90;
        config.length_threshold = 2.0;
        config.max_colors = None;
        let encoded = config.build()?.to_svg(&alpha)?;
        let incremental = (opacity - previous) / (1.0 - previous);
        let contents = body(&encoded).replace("fill=\"#000000\"", "fill=\"#FFFFFF\"");
        masks.push_str(&format!("<g opacity=\"{incremental:.6}\">{contents}</g>"));
        if masks.len() > 8 * 1024 * 1024 {
            return Err(vtracer::Error::Other(
                "Alpha SVG size budget exceeded".into(),
            ));
        }
        previous = opacity;
    }
    Ok(format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><defs><mask id=\"nexora-alpha\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"{}\" height=\"{}\">{masks}</mask></defs><g mask=\"url(#nexora-alpha)\">{}</g></svg>",img.width,img.height,img.width,img.height,img.width,img.height,body(&svg)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pathological_alpha_is_rejected_before_contour_allocation() {
        let mut pixels = vec![0u8; 128 * 128 * 4];
        for y in 0..128 {
            for x in 0..128 {
                let i = (y * 128 + x) * 4;
                pixels[i..i + 4].copy_from_slice(&[
                    220,
                    100,
                    50,
                    if (x + y) % 2 == 0 { 1 } else { 254 },
                ]);
            }
        }
        let img = ColorImage {
            pixels,
            width: 128,
            height: 128,
        };
        let err = apply("<svg/>".into(), &img).unwrap_err();
        assert!(err.to_string().contains("budget exceeded"));
    }
}
