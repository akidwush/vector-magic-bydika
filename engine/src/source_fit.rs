//! Raster-evidence scoring of cached VTracer boundaries; not a tracing frontend.
use std::collections::{HashMap, HashSet};
use vtracer::{
    ColorImage, PointF64,
    mosaic::{FittedGeom, LabelMap, OUTSIDE, Segment},
};
#[derive(Clone)]
pub struct Sample {
    pub x: i32,
    pub y: i32,
    pub coverage: f64,
}
pub fn samples(seg: &Segment, map: &LabelMap, img: &ColorImage) -> Option<Vec<Sample>> {
    if !seg.is_ring() || seg.left == OUTSIDE || seg.right == OUTSIDE {
        return None;
    }
    let area: i64 = seg
        .points
        .windows(2)
        .map(|w| w[0].x as i64 * w[1].y as i64 - w[1].x as i64 * w[0].y as i64)
        .sum();
    let (inside, outside) = if area > 0 {
        (seg.right, seg.left)
    } else {
        (seg.left, seg.right)
    };
    let a = map.paints[inside as usize].color();
    let b = map.paints[outside as usize].color();
    let a = [a.r as f64, a.g as f64, a.b as f64];
    let b = [b.r as f64, b.g as f64, b.b as f64];
    let delta = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let norm = delta.iter().map(|v| v * v).sum::<f64>();
    if norm < 2500. {
        return None;
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    let mut rejected = 0;
    for q in &seg.points {
        for y in q.y - 2..=q.y + 1 {
            for x in q.x - 2..=q.x + 1 {
                if x < 0
                    || y < 0
                    || x >= img.width as i32
                    || y >= img.height as i32
                    || !seen.insert((x, y))
                {
                    continue;
                }
                if seen.len() > 8192 {
                    return None;
                }
                let label = map.label(x, y);
                if label != inside && label != outside {
                    continue;
                }
                let i = (y as usize * img.width + x as usize) * 4;
                if img.pixels[i + 3] != 255 {
                    return None;
                }
                let c = [
                    img.pixels[i] as f64,
                    img.pixels[i + 1] as f64,
                    img.pixels[i + 2] as f64,
                ];
                let t = (0..3).map(|k| (c[k] - b[k]) * delta[k]).sum::<f64>() / norm;
                let residual = (0..3)
                    .map(|k| (c[k] - b[k] - t * delta[k]).powi(2))
                    .sum::<f64>();
                if residual > norm * 0.003 || !(-0.08..=1.08).contains(&t) {
                    rejected += 1;
                    continue;
                }
                result.push(Sample {
                    x,
                    y,
                    coverage: t.clamp(0., 1.),
                });
            }
        }
    }
    if result.len() < 16 || rejected > result.len() / 8 {
        None
    } else {
        Some(result)
    }
}
/// Four-by-four area integration of a closed path. Same rule for old and new.
pub fn error(poly: &[PointF64], samples: &[Sample]) -> f64 {
    if poly.len() < 3 {
        return f64::INFINITY;
    }
    let mut rows: HashMap<i32, Vec<f64>> = HashMap::new();
    let mut loss = 0.;
    for s in samples {
        let mut hits = 0;
        for iy in 0..4 {
            let key = s.y * 4 + iy;
            let xs = rows.entry(key).or_insert_with(|| {
                let y = s.y as f64 + (iy as f64 + 0.5) / 4.;
                let mut xs = Vec::new();
                for w in poly.windows(2) {
                    let (a, b) = (w[0], w[1]);
                    if (a.y <= y && b.y > y) || (b.y <= y && a.y > y) {
                        xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
                    }
                }
                xs.sort_by(f64::total_cmp);
                xs
            });
            for ix in 0..4 {
                let x = s.x as f64 + (ix as f64 + 0.5) / 4.;
                let n = xs.partition_point(|v| *v <= x);
                hits += (n % 2 == 1) as usize;
            }
        }
        loss += (hits as f64 / 16. - s.coverage).powi(2);
    }
    loss / samples.len() as f64
}
#[derive(Clone, Copy)]
struct Ellipse {
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
}
impl Ellipse {
    fn coverage(self, x: i32, y: i32) -> f64 {
        // Pixel-square clipped by the local tangent half-plane of the implicit ellipse.
        let x = x as f64 + 0.5;
        let y = y as f64 + 0.5;
        let f = ((x - self.cx) / self.rx).powi(2) + ((y - self.cy) / self.ry).powi(2) - 1.;
        let gx = 2. * (x - self.cx) / self.rx.powi(2);
        let gy = 2. * (y - self.cy) / self.ry.powi(2);
        let ps = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)];
        let mut clipped = Vec::with_capacity(6);
        for i in 0..4 {
            let a = ps[i];
            let b = ps[(i + 1) % 4];
            let fa = f + gx * a.0 + gy * a.1;
            let fb = f + gx * b.0 + gy * b.1;
            if fa <= 0. {
                clipped.push(a)
            }
            if (fa <= 0.) != (fb <= 0.) {
                let t = fa / (fa - fb);
                clipped.push((a.0 + t * (b.0 - a.0), a.1 + t * (b.1 - a.1)));
            }
        }
        if clipped.len() < 3 {
            return 0.;
        }
        let mut area = 0.;
        for i in 0..clipped.len() {
            let a = clipped[i];
            let b = clipped[(i + 1) % clipped.len()];
            area += a.0 * b.1 - a.1 * b.0;
        }
        area.abs() * 0.5
    }
    fn loss(self, ss: &[Sample]) -> f64 {
        ss.iter()
            .map(|s| (self.coverage(s.x, s.y) - s.coverage).powi(2))
            .sum::<f64>()
            / ss.len() as f64
    }
    fn geometry(self, positive: bool) -> FittedGeom {
        let p = |x, y| PointF64 { x, y };
        let x = self.cx;
        let y = self.cy;
        let a = self.rx;
        let b = self.ry;
        let k = 0.5522847498307936;
        let mut cs = vec![
            [
                p(x + a, y),
                p(x + a, y + k * b),
                p(x + k * a, y + b),
                p(x, y + b),
            ],
            [
                p(x, y + b),
                p(x - k * a, y + b),
                p(x - a, y + k * b),
                p(x - a, y),
            ],
            [
                p(x - a, y),
                p(x - a, y - k * b),
                p(x - k * a, y - b),
                p(x, y - b),
            ],
            [
                p(x, y - b),
                p(x + k * a, y - b),
                p(x + a, y - k * b),
                p(x + a, y),
            ],
        ];
        if !positive {
            cs = cs
                .into_iter()
                .rev()
                .map(|c| [c[3], c[2], c[1], c[0]])
                .collect()
        }
        FittedGeom::Beziers(cs)
    }
}
pub fn ellipse(seg: &Segment, ss: &[Sample]) -> Option<FittedGeom> {
    let x0 = seg.points.iter().map(|p| p.x).min()? as f64;
    let x1 = seg.points.iter().map(|p| p.x).max()? as f64;
    let y0 = seg.points.iter().map(|p| p.y).min()? as f64;
    let y1 = seg.points.iter().map(|p| p.y).max()? as f64;
    let initial = Ellipse {
        cx: (x0 + x1) * 0.5,
        cy: (y0 + y1) * 0.5,
        rx: (x1 - x0) * 0.5,
        ry: (y1 - y0) * 0.5,
    };
    if initial.rx < 2.5
        || initial.ry < 2.5
        || initial.rx / initial.ry < 0.25
        || initial.rx / initial.ry > 4.
    {
        return None;
    }
    let mut e = initial;
    let mut best = e.loss(ss);
    // Bounded numerical optimization of one model, not an online preset sweep.
    for step in [0.4, 0.2, 0.1, 0.05] {
        for _ in 0..2 {
            for dim in 0..4 {
                for sign in [-1., 1.] {
                    let mut trial = e;
                    let v = match dim {
                        0 => &mut trial.cx,
                        1 => &mut trial.cy,
                        2 => &mut trial.rx,
                        _ => &mut trial.ry,
                    };
                    *v += sign * step;
                    if (trial.cx - initial.cx).abs() > 0.8
                        || (trial.cy - initial.cy).abs() > 0.8
                        || (trial.rx - initial.rx).abs() > 0.8
                        || (trial.ry - initial.ry).abs() > 0.8
                    {
                        continue;
                    }
                    let loss = trial.loss(ss);
                    if loss < best {
                        best = loss;
                        e = trial
                    }
                }
            }
        }
    }
    if best > 0.008 {
        return None;
    }
    let area: i64 = seg
        .points
        .windows(2)
        .map(|w| w[0].x as i64 * w[1].y as i64 - w[1].x as i64 * w[0].y as i64)
        .sum();
    Some(e.geometry(area > 0))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sparse_model_preflight_rejects_large_nonelliptic_outlines() {
        let make = |points| Segment {
            points,
            start: None,
            end: None,
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        };
        let circle = make(
            (0..512)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / 512.;
                    vtracer::PointI32 {
                        x: (512. + 340. * a.cos()).round() as i32,
                        y: (512. + 340. * a.sin()).round() as i32,
                    }
                })
                .collect(),
        );
        assert!(sparse_ellipse_candidate(&circle));
        let square = make(vec![
            vtracer::PointI32 { x: 0, y: 0 },
            vtracer::PointI32 { x: 1024, y: 0 },
            vtracer::PointI32 { x: 1024, y: 1024 },
            vtracer::PointI32 { x: 0, y: 1024 },
        ]);
        assert!(!sparse_ellipse_candidate(&square));
        assert!(!sparse_ellipse_candidate(&make(Vec::new())));
    }
    #[test]
    fn source_ellipse_improves_upstream_fit() {
        use vtracer::fitter::{CurveFitter, SplineFitter};
        let e = Ellipse {
            cx: 31.35,
            cy: 32.2,
            rx: 18.7,
            ry: 18.7,
        };
        let mut pixels = Vec::new();
        for y in 0..64 {
            for x in 0..64 {
                let t = e.coverage(x as i32, y as i32);
                let c = (255.0 - 200.0 * t).round() as u8;
                pixels.extend([c, c, c, 255]);
            }
        }
        let img = ColorImage {
            width: 64,
            height: 64,
            pixels,
        };
        let mask = vtracer::ir::RegionMask::new(
            img.to_binary_image(|c| c.r < 155),
            vtracer::PointI32 { x: 0, y: 0 },
        );
        let baseline = SplineFitter::default().fit_region(&mask);
        reset();
        let result = optimize(&mask, &img, baseline);
        assert_eq!(
            accepted(),
            1,
            "source ellipse must replace the faceted spline"
        );
        assert!(matches!(&result[0], FittedGeom::Beziers(cs) if cs.len()==4));
    }
    #[test]
    fn segmentation_cleanup_preserves_design_plateaus_and_real_alpha() {
        let mut pixels = Vec::new();
        for _y in 0..24 {
            for x in 0..24 {
                pixels.extend(if x < 8 {
                    [255, 0, 0, 255]
                } else if x < 16 {
                    [255, 128, 128, 255]
                } else {
                    [255, 255, 255, 255]
                });
            }
        }
        let img = ColorImage {
            width: 24,
            height: 24,
            pixels,
        };
        assert_eq!(
            prepare(&img).1,
            0,
            "a designed pink stripe must remain a third color"
        );
        let mut translucent = img.clone();
        for p in translucent.pixels.chunks_exact_mut(4) {
            p[3] = 128;
        }
        assert_eq!(prepare(&translucent).1, 0);
        use vtracer::fitter::{CurveFitter, PolygonFitter};
        let mask = vtracer::ir::RegionMask::new(
            img.to_binary_image(|c| c.g < 200),
            vtracer::PointI32 { x: 0, y: 0 },
        );
        let baseline = PolygonFitter.fit_region(&mask);
        reset();
        let result = optimize(&mask, &translucent, baseline.clone());
        assert_eq!(accepted(), 0);
        assert_eq!(format!("{result:?}"), format!("{baseline:?}"));
    }
    #[test]
    fn selective_cleanup_changes_a_fractional_diagonal_without_mutating_source() {
        let mut pixels = Vec::new();
        for y in 0..24 {
            for x in 0..24 {
                let t = (0.3 - (x as f64 - y as f64)).clamp(0., 1.);
                let c = (255. * t).round() as u8;
                pixels.extend([c, c, c, 255]);
            }
        }
        let mut img = ColorImage {
            width: 24,
            height: 24,
            pixels,
        };
        assert_eq!(
            prepare(&img).1,
            0,
            "clipped shapes keep their previous segmentation"
        );
        for y in 0..24 {
            for x in 0..24 {
                if x < 4 || y < 4 || x >= 20 || y >= 20 {
                    let i = (y * 24 + x) * 4;
                    img.pixels[i..i + 3].fill(255);
                }
            }
        }
        let copy = img.pixels.clone();
        let (prepared, n) = prepare(&img);
        assert!(n > 0);
        assert!(prepared.is_some());
        assert_eq!(img.pixels, copy);
    }
    #[test]
    fn source_polygon_recovers_three_acute_corners_from_capped_pixels() {
        let tri = [
            PointF64 { x: 32., y: 5. },
            PointF64 { x: 58., y: 58. },
            PointF64 { x: 6., y: 58. },
        ];
        let mut pixels = Vec::new();
        for y in 0..64 {
            for x in 0..64 {
                let mut hits = 0;
                for sy in 0..8 {
                    for sx in 0..8 {
                        let q = PointF64 {
                            x: x as f64 + (sx as f64 + 0.5) / 8.,
                            y: y as f64 + (sy as f64 + 0.5) / 8.,
                        };
                        if (0..3).all(|i| {
                            let a = tri[i];
                            let b = tri[(i + 1) % 3];
                            (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) >= 0.
                        }) {
                            hits += 1;
                        }
                    }
                }
                let t = hits as f64 / 64.;
                pixels.extend([
                    (230. - 200. * t).round() as u8,
                    (120. - 30. * t).round() as u8,
                    (30. + 180. * t).round() as u8,
                    255,
                ]);
            }
        }
        let img = ColorImage {
            width: 64,
            height: 64,
            pixels,
        };
        let mask = vtracer::ir::RegionMask::new(
            img.to_binary_image(|c| c.b > 120),
            vtracer::PointI32 { x: 0, y: 0 },
        );
        let gs = polygonal(&mask, &img).expect("an acute triangle must use straight sides");
        let found = protected_corners(&gs[0]);
        assert_eq!(found.len(), 3);
        for p in tri {
            assert!(
                found
                    .iter()
                    .any(|(q, _)| (q.x - p.x).hypot(q.y - p.y) < 1.5)
            );
        }
        let rounded = Ellipse {
            cx: 32.,
            cy: 32.,
            rx: 26.,
            ry: 26.,
        }
        .geometry(true);
        assert!(!preserves_corners(&gs[0], &rounded));
    }
    #[test]
    fn pixel_area_handles_half_coverage() {
        let e = Ellipse {
            cx: 0.5,
            cy: 0.5,
            rx: 10.,
            ry: 10.,
        };
        assert!((e.coverage(10, 0) - 0.5).abs() < 1e-9);
        assert_eq!(e.coverage(0, 0), 1.);
        assert_eq!(e.coverage(20, 20), 0.);
    }
    #[test]
    fn coverage_scoring_detects_moved_boundary() {
        let p = |x, y| PointF64 { x, y };
        let ss = vec![
            Sample {
                x: 0,
                y: 0,
                coverage: 1.,
            },
            Sample {
                x: 1,
                y: 0,
                coverage: 0.,
            },
        ];
        let a = [p(0., 0.), p(1., 0.), p(1., 1.), p(0., 1.), p(0., 0.)];
        assert_eq!(error(&a, &ss), 0.);
        let b = a.map(|q| p(q.x + 0.5, q.y));
        assert!(error(&b, &ss) > 0.1);
    }
}

thread_local! {static SPARSE:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};static PROTECTED:std::cell::RefCell<Vec<vtracer::ir::SubPath>>=const{std::cell::RefCell::new(Vec::new())};static BUDGET:std::cell::Cell<usize>=const{std::cell::Cell::new(8192)};static ACCEPTED:std::cell::Cell<u32>=const{std::cell::Cell::new(0)};}
pub fn protected() -> Vec<vtracer::ir::SubPath> {
    PROTECTED.with(|p| p.borrow().clone())
}
// Cheap eligibility check for the existing axis-aligned ellipse model. Sparse
// image sampling is reserved for outlines already close to that model; it must
// not spend a coverage solver budget on large organic/straight-sided shapes.
fn sparse_ellipse_candidate(seg: &Segment) -> bool {
    let Some(x0) = seg.points.iter().map(|p| p.x).min() else {
        return false;
    };
    let x1 = seg.points.iter().map(|p| p.x).max().unwrap();
    let y0 = seg.points.iter().map(|p| p.y).min().unwrap();
    let y1 = seg.points.iter().map(|p| p.y).max().unwrap();
    let cx = (x0 as f64 + x1 as f64) * 0.5;
    let cy = (y0 as f64 + y1 as f64) * 0.5;
    let rx = (x1 as f64 - x0 as f64) * 0.5;
    let ry = (y1 as f64 - y0 as f64) * 0.5;
    rx >= 2.5
        && ry >= 2.5
        && seg.points.iter().all(|p| {
            (((p.x as f64 - cx) / rx).hypot((p.y as f64 - cy) / ry) - 1.).abs() * rx.min(ry) <= 2.5
        })
}
pub fn sparse(enabled: bool) {
    SPARSE.with(|s| s.set(enabled));
}
pub fn reset() {
    sparse(false);
    PROTECTED.with(|p| p.borrow_mut().clear());
    BUDGET.with(|b| b.set(8192));
    ACCEPTED.with(|b| b.set(0));
}
pub fn accepted() -> u32 {
    ACCEPTED.with(|b| b.get())
}
fn samples_mask(
    seg: &Segment,
    mask: &vtracer::ir::RegionMask,
    img: &ColorImage,
    sparse: bool,
) -> Option<Vec<Sample>> {
    let mut pixels = Vec::new();
    let mut seen = HashSet::new();
    let mut groups = [Vec::<[f64; 3]>::new(), Vec::<[f64; 3]>::new()];
    let inside = |x: i32, y: i32| {
        let x = x - mask.offset.x;
        let y = y - mask.offset.y;
        x >= 0
            && y >= 0
            && (x as usize) < mask.width()
            && (y as usize) < mask.height()
            && mask.image.get_pixel(x as usize, y as usize)
    };
    let extra: std::collections::HashSet<_> = if sparse && crate::inverse::enabled() {
        crate::corners::detect_source(seg)
            .into_iter()
            .filter(|c| c.protected && c.confidence >= 0.5)
            .map(|c| c.index)
            .collect()
    } else {
        std::collections::HashSet::new()
    };
    let stride = if sparse {
        seg.points.len().div_ceil(512).max(1)
    } else {
        1
    };
    for (index, q) in seg.points.iter().enumerate() {
        if index % stride != 0 && !extra.contains(&index) {
            continue;
        }
        let radius = if extra.contains(&index) { 3 } else { 2 };
        for y in q.y - radius..q.y + radius {
            for x in q.x - radius..q.x + radius {
                if x < 0
                    || y < 0
                    || x >= img.width as i32
                    || y >= img.height as i32
                    || !seen.insert((x, y))
                {
                    continue;
                }
                if seen.len() > 8192 {
                    return None;
                }
                let i = (y as usize * img.width + x as usize) * 4;
                if img.pixels[i + 3] != 255 {
                    return None;
                }
                let c = [
                    img.pixels[i] as f64,
                    img.pixels[i + 1] as f64,
                    img.pixels[i + 2] as f64,
                ];
                groups[inside(x, y) as usize].push(c);
                pixels.push((x, y, c));
            }
        }
    }
    if groups.iter().any(|g| g.len() < 8) {
        return None;
    }
    let med = |g: &[[f64; 3]]| -> [f64; 3] {
        std::array::from_fn(|k| {
            let mut v: Vec<_> = g.iter().map(|c| c[k]).collect();
            v.sort_by(f64::total_cmp);
            v[v.len() / 2]
        })
    };
    let area: i64 = seg
        .points
        .windows(2)
        .map(|w| w[0].x as i64 * w[1].y as i64 - w[1].x as i64 * w[0].y as i64)
        .sum();
    let a = seg.points[0];
    let b = seg.points[1];
    let dx = (b.x - a.x) as f64;
    let dy = (b.y - a.y) as f64;
    let sign = if area > 0 { 1. } else { -1. };
    let ix = ((a.x + b.x) as f64 / 2. - sign * dy * 0.5).floor() as i32;
    let iy = ((a.y + b.y) as f64 / 2. + sign * dx * 0.5).floor() as i32;
    let component_inside = inside(ix, iy);
    let a = med(&groups[component_inside as usize]);
    let b = med(&groups[(!component_inside) as usize]);
    let delta = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let norm = delta.iter().map(|v| v * v).sum::<f64>();
    if norm < 2500. {
        return None;
    }
    let mut samples = Vec::new();
    let mut bad = 0;
    for (x, y, c) in pixels {
        let t = (0..3).map(|k| (c[k] - b[k]) * delta[k]).sum::<f64>() / norm;
        let e = (0..3)
            .map(|k| (c[k] - b[k] - t * delta[k]).powi(2))
            .sum::<f64>();
        if e > norm * 0.003 || !(-0.08..=1.08).contains(&t) {
            bad += 1;
            continue;
        }
        samples.push(Sample {
            x,
            y,
            coverage: t.clamp(0., 1.),
        });
    }
    if samples.len() < 16 || bad > samples.len() / 4 {
        None
    } else {
        Some(samples)
    }
}
fn touches_frame(mask: &vtracer::ir::RegionMask, img: &ColorImage) -> bool {
    let w = mask.width();
    let h = mask.height();
    if w == 0 || h == 0 {
        return true;
    }
    (mask.offset.x <= 0 && (0..h).any(|y| mask.image.get_pixel(0, y)))
        || (mask.offset.y <= 0 && (0..w).any(|x| mask.image.get_pixel(x, 0)))
        || (mask.offset.x as usize + w >= img.width
            && (0..h).any(|y| mask.image.get_pixel(w - 1, y)))
        || (mask.offset.y as usize + h >= img.height
            && (0..w).any(|x| mask.image.get_pixel(x, h - 1)))
}

fn prune_polygon(ps: &[PointF64]) -> Vec<PointF64> {
    let mut p = ps[..ps.len() - 1].to_vec();
    if p.len() > 256 {
        return ps.to_vec();
    }
    for _ in 0..256 {
        let n = p.len();
        if n <= 3 {
            break;
        }
        let mut removed = false;
        for i in 0..n {
            let a = p[(i + n - 1) % n];
            let b = p[i];
            let c = p[(i + 1) % n];
            let u = (b.x - a.x, b.y - a.y);
            let v = (c.x - b.x, c.y - b.y);
            let norm = u.0.hypot(u.1) * v.0.hypot(v.1);
            let angle = if norm > 1e-9 {
                ((u.0 * v.0 + u.1 * v.1) / norm).clamp(-1., 1.).acos()
            } else {
                0.
            };
            let err = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)).abs()
                / (c.x - a.x).hypot(c.y - a.y).max(1e-9);
            if angle < 0.35 && err <= 1.0 {
                p.remove(i);
                removed = true;
                break;
            }
        }
        if !removed {
            break;
        }
    }
    for _ in 0..24 {
        let n = p.len();
        if n <= 3 {
            break;
        }
        let mut collapsed = false;
        for i in 0..n {
            let a = p[(i + n - 1) % n];
            let b = p[i];
            let c = p[(i + 1) % n];
            let d = p[(i + 2) % n];
            let short = (c.x - b.x).hypot(c.y - b.y);
            if short > 6. {
                continue;
            }
            let u = (b.x - a.x, b.y - a.y);
            let v = (d.x - c.x, d.y - c.y);
            if u.0.hypot(u.1) < 5. || v.0.hypot(v.1) < 5. {
                continue;
            }
            let det = u.0 * v.1 - u.1 * v.0;
            if det.abs() < 1e-6 {
                continue;
            }
            let t = ((c.x - a.x) * v.1 - (c.y - a.y) * v.0) / det;
            let q = PointF64 {
                x: a.x + t * u.0,
                y: a.y + t * u.1,
            };
            if (q.x - b.x).hypot(q.y - b.y) > 5. || (q.x - c.x).hypot(q.y - c.y) > 5. {
                continue;
            }
            p[i] = q;
            p.remove((i + 1) % n);
            collapsed = true;
            break;
        }
        if !collapsed {
            break;
        }
    }
    p.push(p[0]);
    p
}
/// Conservative all-straight polygon classification over the upstream DP result.
/// Rounded contours have low-turn or short edges and keep the spline baseline.
fn polygon_outline(mask: &vtracer::ir::RegionMask) -> Option<Vec<FittedGeom>> {
    use vtracer::fitter::CurveFitter;
    let mut gs = vtracer::fitter::PolygonFitter.fit_region(mask);
    if let [FittedGeom::Polyline(ps)] = gs.as_mut_slice() {
        if ps.len() >= 4 {
            *ps = prune_polygon(ps);
        }
    }
    if gs.len() != 1 {
        return None;
    }
    let FittedGeom::Polyline(ps) = &gs[0] else {
        return None;
    };
    let n = ps.len().checked_sub(1)?;
    if !(3..=24).contains(&n) {
        return None;
    }
    for i in 0..n {
        let a = ps[(i + n - 1) % n];
        let b = ps[i];
        let c = ps[(i + 1) % n];
        let u = (b.x - a.x, b.y - a.y);
        let v = (c.x - b.x, c.y - b.y);
        let l = u.0.hypot(u.1);
        let r = v.0.hypot(v.1);
        if l < 3. || r < 3. || ((u.0 * v.0 + u.1 * v.1) / (l * r)).clamp(-1., 1.).acos() < 0.7 {
            return None;
        }
    }
    Some(gs)
}
pub fn polygonal(mask: &vtracer::ir::RegionMask, img: &ColorImage) -> Option<Vec<FittedGeom>> {
    if touches_frame(mask, img) {
        return None;
    }
    use vtracer::fitter::CurveFitter;
    let mut gs = polygon_outline(mask)?;
    let raw = vtracer::fitter::PixelFitter.fit_region(mask);
    let [FittedGeom::Polyline(raw_ps)] = raw.as_slice() else {
        return None;
    };
    let seg = Segment {
        points: raw_ps
            .iter()
            .map(|p| vtracer::PointI32 {
                x: p.x as i32,
                y: p.y as i32,
            })
            .collect(),
        start: None,
        end: None,
        left: 0,
        right: 1,
        first_dir: 0,
        last_dir: 0,
    };
    let FittedGeom::Polyline(mut ps) = gs.remove(0) else {
        return None;
    };
    let ss = samples_mask(&seg, mask, img, false)?;
    {
        if ps.len() > 13 || ss.len() > 4096 {
            return None;
        }
        if !BUDGET.with(|b| {
            if ss.len() > b.get() {
                false
            } else {
                b.set(b.get() - ss.len());
                true
            }
        }) {
            return None;
        }
        let initial = ps.clone();
        let mut best = error(&ps, &ss);
        for step in [0.8, 0.4, 0.2, 0.1] {
            for _ in 0..2 {
                for i in 0..ps.len() - 1 {
                    for axis in 0..2 {
                        let mut chosen = ps.clone();
                        let mut best_here = best;
                        for sign in [-1., 1.] {
                            let mut candidate = ps.clone();
                            if axis == 0 {
                                candidate[i].x += sign * step
                            } else {
                                candidate[i].y += sign * step
                            }
                            if (candidate[i].x - initial[i].x).hypot(candidate[i].y - initial[i].y)
                                > 3.5
                            {
                                continue;
                            }
                            let last = candidate.len() - 1;
                            candidate[last] = candidate[0];
                            let loss = error(&candidate, &ss);
                            if loss < best_here {
                                best_here = loss;
                                chosen = candidate;
                            }
                        }
                        ps = chosen;
                        best = best_here;
                    }
                }
            }
        }
        if best > 0.01 {
            return None;
        }
    }
    let (geom, path) = quantized(FittedGeom::Polyline(ps), img)?;
    if !crate::planar::valid_model(&seg, &geom, img.width as u32, img.height as u32) {
        return None;
    }
    PROTECTED.with(|p| p.borrow_mut().push(path));
    Some(vec![geom])
}
fn protected_corners(g: &FittedGeom) -> Vec<(PointF64, f64)> {
    let curves: Vec<_> = match g {
        FittedGeom::Polyline(ps) => ps.windows(2).map(|w| [w[0], w[0], w[1], w[1]]).collect(),
        FittedGeom::Beziers(cs) => cs.clone(),
    };
    let mut out = Vec::new();
    for i in 0..curves.len() {
        let a = curves[(i + curves.len() - 1) % curves.len()];
        let b = curves[i];
        if (a[3].x - b[0].x).hypot(a[3].y - b[0].y) > 1e-5 {
            continue;
        }
        let before = if (a[3].x - a[2].x).hypot(a[3].y - a[2].y) > 1e-6 {
            a[2]
        } else {
            a[0]
        };
        let after = if (b[1].x - b[0].x).hypot(b[1].y - b[0].y) > 1e-6 {
            b[1]
        } else {
            b[3]
        };
        let u = (a[3].x - before.x, a[3].y - before.y);
        let v = (after.x - b[0].x, after.y - b[0].y);
        let norm = u.0.hypot(u.1) * v.0.hypot(v.1);
        if norm > 1e-8 {
            let angle = ((u.0 * v.0 + u.1 * v.1) / norm).clamp(-1., 1.).acos();
            if angle > 0.65 {
                out.push((b[0], angle));
            }
        }
    }
    out
}
fn preserves_corners(reference: &FittedGeom, candidate: &FittedGeom) -> bool {
    let target = protected_corners(candidate);
    protected_corners(reference).iter().all(|(q, angle)| {
        target.iter().any(|(p, turn)| {
            (q.x - p.x).hypot(q.y - p.y) <= 1.5 && *turn >= (*angle * 0.6).max(0.65)
        })
    })
}
fn model_doc(g: FittedGeom, img: &ColorImage) -> vtracer::ir::VectorDoc {
    let mut doc = vtracer::ir::VectorDoc::new(img.width as u32, img.height as u32);
    let mut path = vtracer::ir::MultiPath::new();
    path.push(g.into_closed_subpath());
    doc.shapes.push(vtracer::ir::Shape {
        paint: vtracer::ir::Paint::Solid(vtracer::Color::new(0, 0, 0)),
        path,
    });
    doc
}
pub(crate) fn from_path(path: &vtracer::ir::SubPath) -> Option<FittedGeom> {
    use vtracer::ir::PathCmd;
    let mut points = Vec::new();
    let mut curves = Vec::new();
    let mut current = PointF64 { x: 0., y: 0. };
    let has_curves = path
        .commands
        .iter()
        .any(|c| matches!(c, PathCmd::CubicTo(..)));
    for cmd in &path.commands {
        match *cmd {
            PathCmd::MoveTo(p) => {
                current = p;
                points.push(p)
            }
            PathCmd::LineTo(p) => {
                if has_curves {
                    curves.push([current, current, p, p])
                } else {
                    points.push(p)
                };
                current = p;
            }
            PathCmd::CubicTo(a, b, p) => {
                curves.push([current, a, b, p]);
                current = p
            }
            PathCmd::Close => {
                if let Some(&start) = points.first() {
                    if (current.x - start.x).hypot(current.y - start.y) > 1e-8 {
                        if has_curves {
                            curves.push([current, current, start, start])
                        } else {
                            points.push(start)
                        }
                    }
                }
            }
        }
    }
    if has_curves {
        Some(FittedGeom::Beziers(curves))
    } else {
        Some(FittedGeom::Polyline(points))
    }
}
fn quantized(g: FittedGeom, img: &ColorImage) -> Option<(FittedGeom, vtracer::ir::SubPath)> {
    use vtracer::optimize::OptimizerPass;
    let mut doc = model_doc(g, img);
    vtracer::optimize::QuantizePass::new(2).run(&mut doc);
    vtracer::optimize::CleanupPass.run(&mut doc);
    let path = doc.shapes.first()?.path.subpaths.first()?.clone();
    Some((from_path(&path)?, path))
}
pub(crate) fn inverse_support(
    mask: &vtracer::ir::RegionMask,
    img: &ColorImage,
) -> Option<(Segment, Vec<Sample>)> {
    if touches_frame(mask, img) {
        return None;
    }
    let seg = raw_segment(mask)?;
    let ss = samples_mask(&seg, mask, img, true)?;
    Some((seg, ss))
}
fn raw_segment(mask: &vtracer::ir::RegionMask) -> Option<Segment> {
    use vtracer::fitter::{CurveFitter, PixelFitter};
    let raw = PixelFitter.fit_region(mask);
    if raw.len() != 1 {
        return None;
    }
    let FittedGeom::Polyline(ps) = &raw[0] else {
        return None;
    };
    if ps.len() < 4 || ps.len() > 16384 {
        return None;
    }
    let seg = Segment {
        points: {
            // Restore unit arc-length samples for multi-scale tangents. Upstream
            // PixelFitter may coalesce axis-aligned runs of very different lengths.
            let mut dense = Vec::new();
            for pair in ps.windows(2) {
                let a = pair[0];
                let b = pair[1];
                let n = (b.x - a.x).abs().max((b.y - a.y).abs()).ceil() as usize;
                if dense.len() + n > 16384 {
                    return None;
                }
                for i in 0..n {
                    let t = i as f64 / n as f64;
                    dense.push(vtracer::PointI32 {
                        x: (a.x + (b.x - a.x) * t).round() as i32,
                        y: (a.y + (b.y - a.y) * t).round() as i32,
                    });
                }
            }
            dense.push(vtracer::PointI32 {
                x: ps.last().unwrap().x as i32,
                y: ps.last().unwrap().y as i32,
            });
            dense
        },
        start: None,
        end: None,
        left: 0,
        right: 1,
        first_dir: 0,
        last_dir: 0,
    };
    Some(seg)
}
pub(crate) fn inverse_reference(g: &FittedGeom, img: &ColorImage) -> Option<FittedGeom> {
    use vtracer::optimize::OptimizerPass;
    let mut doc = model_doc(g.clone(), img);
    vtracer::optimize::QuantizePass::new(2).run(&mut doc);
    vtracer::optimize::CleanupPass.run(&mut doc);
    crate::coverage::refine_except(&mut doc, img, &protected());
    from_path(doc.shapes.first()?.path.subpaths.first()?)
}
pub(crate) fn protect_inverse(
    model: FittedGeom,
    old: &FittedGeom,
    img: &ColorImage,
) -> Option<FittedGeom> {
    let (model, path) = quantized(model, img)?;
    let (_, old_path) = quantized(old.clone(), img)?;
    crate::inverse::remember(path.clone(), old_path);
    PROTECTED.with(|p| p.borrow_mut().push(path));
    Some(model)
}

/// Preserve the upstream painter representation; only replace a single safe contour.
pub fn optimize(
    mask: &vtracer::ir::RegionMask,
    img: &ColorImage,
    baseline: Vec<FittedGeom>,
) -> Vec<FittedGeom> {
    use vtracer::fitter::CurveFitter;
    // The missing side of a canvas-clipped boundary supplies no source evidence.
    if baseline.len() != 1 || touches_frame(mask, img) {
        return baseline;
    }
    let Some(seg) = raw_segment(mask) else {
        return baseline;
    };
    let mut subsampled = false;
    let samples = samples_mask(&seg, mask, img, false).or_else(|| {
        if SPARSE.with(|s| s.get()) && seg.points.len() > 2048 && sparse_ellipse_candidate(&seg) {
            subsampled = true;
            samples_mask(&seg, mask, img, true)
        } else {
            None
        }
    });
    let Some(samples) = samples else {
        return baseline;
    };
    let allowed = BUDGET.with(|b| {
        if samples.len() > b.get() {
            false
        } else {
            b.set(b.get() - samples.len());
            true
        }
    });
    if !allowed {
        return baseline;
    }
    if !crate::planar::aligned(&seg, &baseline[0]) {
        return baseline;
    }
    // Compare against the actual previous Auto result, including Stage 1.2 refinement.
    let mut old_doc = model_doc(baseline[0].clone(), img);
    crate::coverage::refine(&mut old_doc, img);
    let old_geom =
        from_path(&old_doc.shapes[0].path.subpaths[0]).unwrap_or_else(|| baseline[0].clone());
    let old = error(&crate::planar::flatten(&old_geom), &samples);
    let mut best = old;
    let mut result = None;
    let generic = if subsampled {
        None
    } else {
        crate::corners::fit(&seg, 0, Some(img))
    };
    let polygon = vtracer::fitter::PolygonFitter.fit_region(mask);
    let polygon =
        if polygon.len() == 1 && matches!(&polygon[0],FittedGeom::Polyline(ps) if ps.len()<=8) {
            polygon.into_iter().next()
        } else {
            None
        };
    let ellipse = ellipse(&seg, &samples);
    // Corner protection survives model-work budget exhaustion. A strong ellipse
    // hypothesis is handled separately; pixel polygon corners on circles are false.
    let critical = if ellipse.is_none() {
        polygon_outline(mask)
    } else {
        None
    };
    let polygon = if subsampled { None } else { polygon };
    for model in [generic, ellipse, polygon].into_iter().flatten() {
        let Some((model, path)) = quantized(model, img) else {
            continue;
        };
        if critical
            .as_ref()
            .is_some_and(|g| !preserves_corners(&g[0], &model))
            || (matches!(&baseline[0], FittedGeom::Polyline(_))
                && !preserves_corners(&old_geom, &model))
        {
            continue;
        }
        if !crate::planar::valid_model(&seg, &model, img.width as u32, img.height as u32) {
            continue;
        }
        let e = error(&crate::planar::flatten(&model), &samples);
        if e + 0.00005 < old * 0.95 && e < 0.01 && e < best {
            best = e;
            result = Some((model, path))
        }
    }
    if let Some((model, path)) = result {
        PROTECTED.with(|p| p.borrow_mut().push(path));
        ACCEPTED.with(|n| n.set(n.get() + 1));
        vec![model]
    } else {
        baseline
    }
}

fn signed_area(g: &FittedGeom) -> f64 {
    crate::planar::flatten(g)
        .windows(2)
        .map(|w| w[0].x * w[1].y - w[1].x * w[0].y)
        .sum()
}
fn reverse(g: FittedGeom) -> FittedGeom {
    match g {
        FittedGeom::Polyline(p) => FittedGeom::Polyline(p.into_iter().rev().collect()),
        FittedGeom::Beziers(c) => FittedGeom::Beziers(
            c.into_iter()
                .rev()
                .map(|p| [p[3], p[2], p[1], p[0]])
                .collect(),
        ),
    }
}
/// Refine isolated shared rings in the *existing* watershed/mosaic document.
/// The pair is replaced atomically by one cached geometry and its exact reversal.
/// Open chains/junctions keep the previous pipeline unchanged.
pub fn refine_mosaic(doc: &mut vtracer::ir::VectorDoc, map: &LabelMap, img: &ColorImage) {
    use vtracer::mosaic::BoundaryGraph;
    let paths: Vec<_> = doc
        .shapes
        .iter()
        .enumerate()
        .flat_map(|(i, s)| {
            s.path
                .subpaths
                .iter()
                .enumerate()
                .filter_map(move |(j, p)| from_path(p).map(|g| (i, j, g)))
        })
        .collect();
    if paths.len() > 256 {
        return;
    }
    let mut cracks = 0;
    for y in 0..map.height as i32 {
        for x in 0..map.width as i32 {
            let a = map.label(x, y);
            cracks += (a != map.label(x + 1, y)) as usize + (a != map.label(x, y + 1)) as usize;
            if cracks > 65536 {
                return;
            }
        }
    }
    let graph = BoundaryGraph::extract(map);
    if graph.segments.len() > 256 {
        return;
    }
    let mut current: Vec<_> = paths.iter().map(|p| p.2.clone()).collect();
    for (id, seg) in graph.segments.iter().enumerate() {
        let Some(ss) = samples(seg, map, img) else {
            continue;
        };
        let allowed = BUDGET.with(|b| {
            if ss.len() > b.get() {
                false
            } else {
                b.set(b.get() - ss.len());
                true
            }
        });
        if !allowed {
            continue;
        }
        let matched: Vec<_> = current
            .iter()
            .enumerate()
            .filter(|(_, g)| {
                crate::planar::aligned(seg, g)
                    && crate::planar::valid_model(
                        seg,
                        &oriented((*g).clone(), seg),
                        img.width as u32,
                        img.height as u32,
                    )
            })
            .map(|(i, _)| i)
            .collect();
        if matched.len() != 2 {
            continue;
        }
        let old = matched
            .iter()
            .map(|&i| error(&crate::planar::flatten(&current[i]), &ss))
            .fold(f64::INFINITY, f64::min);
        let mut best = old;
        let mut selected = None;
        for g in [crate::corners::fit(seg, id, Some(img)), ellipse(seg, &ss)]
            .into_iter()
            .flatten()
        {
            let Some((g, _)) = quantized(g, img) else {
                continue;
            };
            if !crate::planar::valid_model(seg, &g, img.width as u32, img.height as u32) {
                continue;
            }
            let e = error(&crate::planar::flatten(&g), &ss);
            if e + 0.00005 >= old * 0.95 || e >= 0.01 || e >= best {
                continue;
            }
            let others: Vec<_> = current
                .iter()
                .enumerate()
                .filter(|(i, _)| !matched.contains(i))
                .map(|(_, g)| g.clone())
                .collect();
            if !crate::planar::replacement_clear(&g, &others) {
                continue;
            }
            best = e;
            selected = Some(g);
        }
        if let Some(g) = selected {
            for &i in &matched {
                let target = if signed_area(&current[i]) * signed_area(&g) > 0. {
                    g.clone()
                } else {
                    reverse(g.clone())
                };
                doc.shapes[paths[i].0].path.subpaths[paths[i].1] =
                    target.clone().into_closed_subpath();
                current[i] = target;
            }
            ACCEPTED.with(|n| n.set(n.get() + 1));
        }
    }
}
fn oriented(g: FittedGeom, seg: &Segment) -> FittedGeom {
    let area: f64 = seg
        .points
        .windows(2)
        .map(|w| w[0].x as f64 * w[1].y as f64 - w[1].x as f64 * w[0].y as f64)
        .sum();
    if area * signed_area(&g) > 0. {
        g
    } else {
        reverse(g)
    }
}

/// Selective two-color decontamination for segmentation only. Original RGBA is
/// retained for coverage fitting. Stable third-color plateaus and alpha are skipped.
pub fn prepare(img: &ColorImage) -> (Option<ColorImage>, usize) {
    // Keep the original segmentation when its boundary bands can exceed the
    // local model's bounded work. Model-only refinement remains available.
    if img.width.max(img.height) > 256 {
        return (None, 0);
    }
    // Multiple colors on the canvas border indicate clipped regions: keep the
    // previous segmentation, since their missing exterior cannot support this model.
    let first = &img.pixels[..3];
    let border = (0..img.width)
        .flat_map(|x| [(x, 0), (x, img.height - 1)])
        .chain((0..img.height).flat_map(|y| [(0, y), (img.width - 1, y)]));
    for (x, y) in border {
        let i = (y * img.width + x) * 4;
        if (0..3).any(|k| (img.pixels[i + k] as i16 - first[k] as i16).abs() > 12) {
            return (None, 0);
        }
    }
    let mut prepared = None;
    let mut changed = 0;
    let color = |x: i32, y: i32| -> Option<[f64; 3]> {
        if x < 0 || y < 0 || x >= img.width as i32 || y >= img.height as i32 {
            return None;
        }
        let i = (y as usize * img.width + x as usize) * 4;
        if img.pixels[i + 3] != 255 {
            return None;
        }
        Some([
            img.pixels[i] as f64,
            img.pixels[i + 1] as f64,
            img.pixels[i + 2] as f64,
        ])
    };
    let dist = |a: [f64; 3], b: [f64; 3]| (0..3).map(|k| (a[k] - b[k]).powi(2)).sum::<f64>().sqrt();
    for y in 3..img.height as i32 - 3 {
        for x in 3..img.width as i32 - 3 {
            let Some(c) = color(x, y) else { continue };
            // A repeated local design color is not proof of a transition.
            let same = [(-1, 0), (1, 0), (0, -1), (0, 1)]
                .into_iter()
                .filter(|&(dx, dy)| color(x + dx, y + dy).is_some_and(|q| dist(q, c) < 2.))
                .count();
            if same >= 2 {
                continue;
            }
            let mut proposal = None;
            let mut confidence = f64::INFINITY;
            for (dx, dy) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
                let (Some(a), Some(b), Some(aa), Some(bb)) = (
                    color(x - 2 * dx, y - 2 * dy),
                    color(x + 2 * dx, y + 2 * dy),
                    color(x - 3 * dx, y - 3 * dy),
                    color(x + 3 * dx, y + 3 * dy),
                ) else {
                    continue;
                };
                if dist(a, aa) > 3. || dist(b, bb) > 3. {
                    continue;
                }
                let d = std::array::from_fn::<_, 3, _>(|k| a[k] - b[k]);
                let norm = d.iter().map(|v| v * v).sum::<f64>();
                if norm < 2500. {
                    continue;
                }
                let coverage =
                    |p: [f64; 3]| (0..3).map(|k| (p[k] - b[k]) * d[k]).sum::<f64>() / norm;
                let t = coverage(c);
                if !(0.02..0.98).contains(&t) {
                    continue;
                }
                let residual = dist(c, std::array::from_fn(|k| b[k] + t * d[k]));
                if residual > 2.5 {
                    continue;
                }
                let mut consistent = true;
                for offset in [-1, 0, 1] {
                    let px = x - offset * dy;
                    let py = y + offset * dx;
                    let (Some(before), Some(after)) =
                        (color(px - dx, py - dy), color(px + dx, py + dy))
                    else {
                        consistent = false;
                        break;
                    };
                    if coverage(before) - coverage(after) < 0.15 {
                        consistent = false;
                        break;
                    }
                }
                if !consistent {
                    continue;
                }
                if residual < confidence {
                    confidence = residual;
                    proposal = Some(if t >= 0.5 { a } else { b });
                }
            }
            if let Some(c) = proposal {
                let out = prepared.get_or_insert_with(|| img.clone());
                let i = (y as usize * img.width + x as usize) * 4;
                for k in 0..3 {
                    out.pixels[i + k] = c[k].round() as u8;
                }
                changed += 1;
            }
        }
    }
    (prepared, changed)
}
