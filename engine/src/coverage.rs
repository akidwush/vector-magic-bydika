//! Conservative refinement of existing VTracer geometry, not a tracing frontend.
//! Pixels are samples at (x+.5,y+.5). All displacement is bounded to .65px.
use vtracer::{
    ir::{PathCmd, VectorDoc},
    ColorImage, PointF64,
};
#[derive(Default, Clone, Copy)]
pub struct Evidence {
    pub accepted: usize,
    pub rejected: usize,
    pub srgb: usize,
    pub linear: usize,
}
fn sample(img: &ColorImage, x: f64, y: f64) -> Option<[f64; 4]> {
    sample_model(img, x, y, false)
}
fn sample_model(img: &ColorImage, x: f64, y: f64, linear: bool) -> Option<[f64; 4]> {
    if x < 0.5 || y < 0.5 || x > img.width as f64 - 0.5 || y > img.height as f64 - 0.5 {
        return None;
    }
    let fx = x - 0.5;
    let fy = y - 0.5;
    let ix = fx.floor() as usize;
    let iy = fy.floor() as usize;
    let mut out = [0.0; 4];
    for (xx, yy, w) in [
        (ix, iy, (1.0 - fx.fract()) * (1.0 - fy.fract())),
        (
            (ix + 1).min(img.width - 1),
            iy,
            fx.fract() * (1.0 - fy.fract()),
        ),
        (
            ix,
            (iy + 1).min(img.height - 1),
            (1.0 - fx.fract()) * fy.fract(),
        ),
        (
            (ix + 1).min(img.width - 1),
            (iy + 1).min(img.height - 1),
            fx.fract() * fy.fract(),
        ),
    ] {
        let i = (yy * img.width + xx) * 4;
        for c in 0..4 {
            let encoded = img.pixels[i + c] as f64 / 255.0;
            let value = if linear && c < 3 {
                if encoded <= 0.04045 {
                    encoded / 12.92
                } else {
                    ((encoded + 0.055) / 1.055).powf(2.4)
                }
            } else {
                encoded
            };
            out[c] += value * w;
        }
    }
    Some(out)
}
fn median(mut a: [f64; 3]) -> f64 {
    a.sort_by(f64::total_cmp);
    a[1]
}
fn color(img: &ColorImage, p: PointF64, n: PointF64, t: PointF64, s: f64) -> Option<[f64; 3]> {
    let mut rgb = [[0.0; 3]; 3];
    for (i, offset) in [-1.0, 0.0, 1.0].iter().enumerate() {
        let c = sample(
            img,
            p.x + n.x * s + t.x * offset,
            p.y + n.y * s + t.y * offset,
        )?;
        if c[3] < 0.999 {
            return None;
        }
        rgb[i] = [c[0], c[1], c[2]];
    }
    let out = [
        median([rgb[0][0], rgb[1][0], rgb[2][0]]),
        median([rgb[0][1], rgb[1][1], rgb[2][1]]),
        median([rgb[0][2], rgb[1][2], rgb[2][2]]),
    ];
    if rgb
        .iter()
        .any(|c| c.iter().zip(out).map(|(a, b)| (a - b).powi(2)).sum::<f64>() > 0.002)
    {
        return None;
    }
    Some(out)
}
fn space(c: [f64; 3], linear: bool) -> [f64; 3] {
    c.map(|x| {
        if !linear {
            x
        } else if x <= 0.04045 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        }
    })
}
fn fit(
    img: &ColorImage,
    p: PointF64,
    t: PointF64,
    n: PointF64,
    linear: bool,
) -> Option<(f64, f64)> {
    let a = space(color(img, p, n, t, -2.5)?, linear);
    let b = space(color(img, p, n, t, 2.5)?, linear);
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let norm = d.iter().map(|v| v * v).sum::<f64>();
    if norm < 0.03 {
        return None;
    }
    let mut rows = Vec::new();
    let mut residual = 0.0;
    for tangent in [-1.0, 0.0, 1.0] {
        for s in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let c = sample_model(
                img,
                p.x + n.x * s + t.x * tangent,
                p.y + n.y * s + t.y * tangent,
                linear,
            )?;
            if c[3] < 0.999 {
                return None;
            }
            let c = [c[0], c[1], c[2]];
            let coverage =
                ((0..3).map(|k| (c[k] - b[k]) * d[k]).sum::<f64>() / norm).clamp(0.0, 1.0);
            let error = (0..3)
                .map(|k| (c[k] - (b[k] + coverage * d[k])).powi(2))
                .sum::<f64>();
            if error > 0.0018 {
                return None;
            }
            if coverage > 0.08 && coverage < 0.92 {
                rows.push((s, coverage));
                residual += error;
            }
        }
    }
    if rows.len() < 5 {
        return None;
    }
    let count = rows.len() as f64;
    let mx = rows.iter().map(|r| r.0).sum::<f64>() / count;
    let my = rows.iter().map(|r| r.1).sum::<f64>() / count;
    let denom = rows.iter().map(|r| (r.0 - mx).powi(2)).sum::<f64>();
    if denom < 0.1 {
        return None;
    }
    let slope = rows.iter().map(|r| (r.0 - mx) * (r.1 - my)).sum::<f64>() / denom;
    if slope.abs() < 0.16 || slope.abs() > 1.2 {
        return None;
    }
    let variance = rows
        .iter()
        .map(|r| (r.1 - (my + slope * (r.0 - mx))).powi(2))
        .sum::<f64>()
        / count;
    if variance > 0.012 {
        return None;
    }
    let shift = mx + (0.5 - my) / slope;
    if shift.abs() > 0.65 {
        return None;
    }
    Some((shift, residual / (count * norm) + variance))
}
fn displacement(
    img: &ColorImage,
    p: PointF64,
    prev: PointF64,
    next: PointF64,
    e: &mut Evidence,
) -> PointF64 {
    if e.accepted + e.rejected >= 8192 {
        return PointF64 { x: 0.0, y: 0.0 };
    }
    let a = PointF64 {
        x: p.x - prev.x,
        y: p.y - prev.y,
    };
    let b = PointF64 {
        x: next.x - p.x,
        y: next.y - p.y,
    };
    let al = a.x.hypot(a.y);
    let bl = b.x.hypot(b.y);
    if al < 0.01 || bl < 0.01 || (a.x * b.x + a.y * b.y) / (al * bl) < 0.7 {
        e.rejected += 1;
        return PointF64 { x: 0.0, y: 0.0 };
    }
    let tx = a.x / al + b.x / bl;
    let ty = a.y / al + b.y / bl;
    let len = tx.hypot(ty);
    let t = PointF64 {
        x: tx / len,
        y: ty / len,
    };
    let n = PointF64 { x: -t.y, y: t.x };
    let s = fit(img, p, t, n, false);
    let l = fit(img, p, t, n, true);
    let selected = match (s, l) {
        (Some(s), Some(l)) if (s.0 - l.0).abs() <= 0.25 => {
            if l.1 + 0.0001 < s.1 {
                e.linear += 1;
                Some(l)
            } else {
                e.srgb += 1;
                Some(s)
            }
        }
        (Some(s), None) => {
            e.srgb += 1;
            Some(s)
        }
        (None, Some(l)) => {
            e.linear += 1;
            Some(l)
        }
        _ => None,
    };
    if let Some((offset, _)) = selected {
        e.accepted += 1;
        PointF64 {
            x: n.x * offset,
            y: n.y * offset,
        }
    } else {
        e.rejected += 1;
        PointF64 { x: 0.0, y: 0.0 }
    }
}
fn end(cmd: &PathCmd) -> Option<PointF64> {
    match cmd {
        PathCmd::MoveTo(p) | PathCmd::LineTo(p) => Some(*p),
        PathCmd::CubicTo(_, _, p) => Some(*p),
        _ => None,
    }
}
fn plus(p: PointF64, d: PointF64) -> PointF64 {
    PointF64 {
        x: p.x + d.x,
        y: p.y + d.y,
    }
}
pub fn refine(doc: &mut VectorDoc, img: &ColorImage) -> Evidence {
    refine_except(doc, img, &[])
}
/// Accepted source models already minimize coverage error; do not displace them again.
pub fn refine_except(
    doc: &mut VectorDoc,
    img: &ColorImage,
    protected: &[vtracer::ir::SubPath],
) -> Evidence {
    let mut evidence = Evidence::default();
    if doc
        .shapes
        .iter()
        .flat_map(|s| &s.path.subpaths)
        .map(|p| p.commands.len())
        .sum::<usize>()
        > 65536
    {
        return evidence;
    }
    for shape in &mut doc.shapes {
        for path in &mut shape.path.subpaths {
            if protected.contains(path) {
                continue;
            }
            let vertices: Vec<usize> = path
                .commands
                .iter()
                .enumerate()
                .filter_map(|(i, c)| end(c).map(|_| i))
                .collect();
            let points: Vec<PointF64> = path.commands.iter().filter_map(end).collect();
            if points.len() < 3 {
                continue;
            }
            let closed = (points[0].x - points[points.len() - 1].x).abs()
                + (points[0].y - points[points.len() - 1].y).abs()
                < 0.001;
            let count = points.len() - usize::from(closed);
            if count < 3 {
                continue;
            }
            let mut shifts: Vec<PointF64> = (0..count)
                .map(|i| {
                    let incoming = if i == 0 {
                        if closed {
                            path.commands[vertices[points.len() - 1]]
                        } else {
                            PathCmd::LineTo(points[0])
                        }
                    } else {
                        path.commands[vertices[i]]
                    };
                    let prev = match incoming {
                        PathCmd::CubicTo(_, b, _) => b,
                        _ => points[(i + count - 1) % count],
                    };
                    let next = match path.commands[vertices[(i + 1) % count]] {
                        PathCmd::CubicTo(a, _, _) => a,
                        _ => points[(i + 1) % count],
                    };
                    displacement(img, points[i], prev, next, &mut evidence)
                })
                .collect();
            // Straight-edge support lines are estimated at three separated sites.
            // Intersect translated support lines to keep corner angles sharp.
            let mut lines: Vec<Option<(PointF64, f64)>> = vec![None; count];
            for j in 0..count {
                let k = (j + 1) % count;
                let a = points[j];
                let b = points[k];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let length = dx.hypot(dy);
                if length < 6.0 {
                    continue;
                }
                let n = PointF64 {
                    x: -dy / length,
                    y: dx / length,
                };
                let next_cmd = if k == 0 {
                    if closed {
                        path.commands[vertices[points.len() - 1]]
                    } else {
                        PathCmd::LineTo(points[0])
                    }
                } else {
                    path.commands[vertices[k]]
                };
                let straight = match next_cmd {
                    PathCmd::LineTo(_) => true,
                    PathCmd::CubicTo(c, d, _) => {
                        ((c.x - a.x) * n.x + (c.y - a.y) * n.y).abs() < 0.02
                            && ((d.x - a.x) * n.x + (d.y - a.y) * n.y).abs() < 0.02
                    }
                    _ => false,
                };
                if !straight {
                    continue;
                }
                let mut estimates = Vec::new();
                for fraction in [0.25, 0.5, 0.75] {
                    let site = PointF64 {
                        x: a.x + dx * fraction,
                        y: a.y + dy * fraction,
                    };
                    let before = evidence.accepted;
                    let delta = displacement(img, site, a, b, &mut evidence);
                    if evidence.accepted > before {
                        estimates.push(delta.x * n.x + delta.y * n.y);
                    }
                }
                if estimates.len() >= 2 {
                    estimates.sort_by(f64::total_cmp);
                    if estimates.last().unwrap() - estimates[0] < 0.15 {
                        lines[j] = Some((n, estimates[estimates.len() / 2]));
                    }
                }
                // The canvas frame is an exact clipping boundary, not an AA inference.
                if lines[j].is_none()
                    && ((a.x - b.x).abs() < 0.001 && (a.x == 0.0 || a.x == img.width as f64)
                        || (a.y - b.y).abs() < 0.001 && (a.y == 0.0 || a.y == img.height as f64))
                {
                    lines[j] = Some((n, 0.0));
                }
            }
            for j in 0..count {
                if let (Some((a, da)), Some((b, db))) = (lines[(j + count - 1) % count], lines[j]) {
                    let det = a.x * b.y - a.y * b.x;
                    if det.abs() > 0.25 {
                        let shift = PointF64 {
                            x: (da * b.y - a.y * db) / det,
                            y: (a.x * db - da * b.x) / det,
                        };
                        if shift.x.hypot(shift.y) <= 0.65 {
                            shifts[j] = shift;
                        }
                    }
                }
            }
            if closed {
                shifts.push(shifts[0]);
            }
            let mut index = 0;
            let mut previous = shifts[0];
            for cmd in &mut path.commands {
                match cmd {
                    PathCmd::MoveTo(p) | PathCmd::LineTo(p) => {
                        *p = plus(*p, shifts[index]);
                        previous = shifts[index];
                        index += 1;
                    }
                    PathCmd::CubicTo(a, b, p) => {
                        *a = plus(*a, previous);
                        *b = plus(*b, shifts[index]);
                        *p = plus(*p, shifts[index]);
                        previous = shifts[index];
                        index += 1;
                    }
                    _ => {}
                }
            }
        }
    }
    evidence
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scene(linear: bool, alpha: u8) -> ColorImage {
        let a = [0.9, 0.1, 0.2];
        let b = [0.1, 0.8, 0.9];
        let mut pixels = Vec::new();
        for _y in 0..16 {
            for x in 0..16 {
                let t = (8.25 - x as f64).clamp(0.0, 1.0);
                let aa = space(a, linear);
                let bb = space(b, linear);
                for k in 0..3 {
                    let v = t * aa[k] + (1.0 - t) * bb[k];
                    let encoded = if linear {
                        if v <= 0.0031308 {
                            12.92 * v
                        } else {
                            1.055 * v.powf(1.0 / 2.4) - 0.055
                        }
                    } else {
                        v
                    };
                    pixels.push((encoded * 255.0).round() as u8);
                }
                pixels.push(alpha);
            }
        }
        ColorImage {
            pixels,
            width: 16,
            height: 16,
        }
    }
    #[test]
    fn srgb_box_coverage_recovers_fractional_edge() {
        let r = fit(
            &scene(false, 255),
            PointF64 { x: 8.0, y: 8.0 },
            PointF64 { x: 0.0, y: 1.0 },
            PointF64 { x: 1.0, y: 0.0 },
            false,
        )
        .expect("fit known blend");
        assert!((r.0 - 0.25).abs() < 0.15, "offset {}", r.0);
    }
    #[test]
    fn linear_light_model_recovers_fractional_edge() {
        let r = fit(
            &scene(true, 255),
            PointF64 { x: 8.0, y: 8.0 },
            PointF64 { x: 0.0, y: 1.0 },
            PointF64 { x: 1.0, y: 0.0 },
            true,
        )
        .expect("fit linear blend");
        assert!((r.0 - 0.25).abs() < 0.2, "offset {}", r.0);
    }
    #[test]
    fn partial_alpha_is_not_misread_as_rgb_blending() {
        assert!(fit(
            &scene(false, 128),
            PointF64 { x: 8.0, y: 8.0 },
            PointF64 { x: 0.0, y: 1.0 },
            PointF64 { x: 1.0, y: 0.0 },
            false
        )
        .is_none());
    }
    #[test]
    fn genuine_constant_pink_is_not_an_edge() {
        let img = ColorImage {
            pixels: [255, 128, 128, 255].repeat(256),
            width: 16,
            height: 16,
        };
        assert!(fit(
            &img,
            PointF64 { x: 8.0, y: 8.0 },
            PointF64 { x: 0.0, y: 1.0 },
            PointF64 { x: 1.0, y: 0.0 },
            false
        )
        .is_none());
    }
    #[test]
    fn direct_corner_offset_is_rejected() {
        let mut e = Evidence::default();
        let d = displacement(
            &scene(false, 255),
            PointF64 { x: 8.0, y: 8.0 },
            PointF64 { x: 6.0, y: 8.0 },
            PointF64 { x: 8.0, y: 6.0 },
            &mut e,
        );
        assert_eq!(d.x, 0.0);
        assert_eq!(d.y, 0.0);
    }
}

/// Experimental pre-segmentation labeling at high-confidence two-color edges only.
/// The original image remains the source for subpixel fitting and alpha.
pub fn prepare(img: &ColorImage) -> (Option<ColorImage>, usize) {
    let mut prepared: Option<ColorImage> = None;
    let mut changed = 0usize;
    let mut attempts = 0usize;
    if img.width < 7 || img.height < 7 {
        return (None, 0);
    }
    for y in 3..img.height - 3 {
        for x in 3..img.width - 3 {
            let i = (y * img.width + x) * 4;
            if img.pixels[i + 3] != 255 {
                continue;
            }
            let mut strength = 0.0;
            let mut gradient = (0.0, 0.0);
            for c in 0..3 {
                let gx = img.pixels[i + 4 + c] as f64 - img.pixels[i - 4 + c] as f64;
                let gy = img.pixels[i + img.width * 4 + c] as f64
                    - img.pixels[i - img.width * 4 + c] as f64;
                let s = gx * gx + gy * gy;
                if s > strength {
                    strength = s;
                    gradient = (gx, gy);
                }
            }
            if strength < 32.0 * 32.0 {
                continue;
            }
            attempts += 1;
            if attempts > 8192 {
                return (prepared, changed);
            }
            let len = gradient.0.hypot(gradient.1);
            let n = PointF64 {
                x: gradient.0 / len,
                y: gradient.1 / len,
            };
            let t = PointF64 { x: -n.y, y: n.x };
            let p = PointF64 {
                x: x as f64 + 0.5,
                y: y as f64 + 0.5,
            };
            let a = fit(img, p, t, n, false);
            let b = fit(img, p, t, n, true);
            let estimate = match (a, b) {
                (Some(a), Some(b)) if (a.0 - b.0).abs() <= 0.25 => {
                    if a.1 <= b.1 {
                        Some(a)
                    } else {
                        Some(b)
                    }
                }
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                _ => None,
            };
            if let Some((offset, _)) = estimate {
                if offset.abs() < 0.05 {
                    continue;
                }
                if let Some(c) = color(img, p, n, t, if offset > 0.0 { -2.5 } else { 2.5 }) {
                    let rgb = c.map(|v| (v * 255.0).round() as u8);
                    if rgb.iter().zip(&img.pixels[i..i + 3]).any(|(a, b)| a != b) {
                        let out = prepared.get_or_insert_with(|| img.clone());
                        out.pixels[i..i + 3].copy_from_slice(&rgb);
                        changed += 1;
                    }
                }
            }
        }
    }
    (prepared, changed)
}
