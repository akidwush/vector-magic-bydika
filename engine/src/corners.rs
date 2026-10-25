//! Multi-scale evidence over upstream crack chains; geometry fitting uses flo_curves
//! (the same Schneider implementation used by VTracer SimplifyCurves).
use flo_curves::{
    Coord2,
    bezier::{Curve, fit_curve_cubic},
};
use std::cell::RefCell;
use vtracer::{
    ColorImage, PointF64,
    mosaic::{FittedGeom, Segment},
};
thread_local! {static RECORDS:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub fn reset() {
    RECORDS.with(|r| r.borrow_mut().clear());
}
pub fn evidence() -> Vec<f64> {
    RECORDS.with(|r| r.borrow().clone())
}
fn p(x: f64, y: f64) -> PointF64 {
    PointF64 { x, y }
}
fn distance(a: PointF64, b: PointF64) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
#[derive(Clone, Debug)]
pub struct Corner {
    pub index: usize,
    pub class: u8,
    pub confidence: f64,
    pub position: PointF64,
    pub protected: bool,
}
pub fn detect(seg: &Segment) -> Vec<Corner> {
    let n = seg.points.len() - seg.is_ring() as usize;
    let points: Vec<_> = seg.points[..n]
        .iter()
        .map(|q| p(q.x as f64, q.y as f64))
        .collect();
    let mut out = Vec::new();
    if n < 3 {
        return out;
    }
    let at = |i: isize| {
        points[if seg.is_ring() {
            i.rem_euclid(n as isize) as usize
        } else {
            i.clamp(0, n as isize - 1) as usize
        }]
    };
    for i in 0..n {
        let q = points[i];
        let junction = !seg.is_ring() && (i == 0 || i == n - 1);
        let scales = [3usize, 6, 10].map(|v| v.min((n / 4).max(1)));
        let arm = |before: bool, scale: usize| {
            let pts: Vec<_> = (2..=scale.max(3))
                .map(|k| at(i as isize + if before { -(k as isize) } else { k as isize }))
                .collect();
            let m = p(
                pts.iter().map(|q| q.x).sum::<f64>() / pts.len() as f64,
                pts.iter().map(|q| q.y).sum::<f64>() / pts.len() as f64,
            );
            let xx = pts.iter().map(|q| (q.x - m.x).powi(2)).sum::<f64>();
            let yy = pts.iter().map(|q| (q.y - m.y).powi(2)).sum::<f64>();
            let xy = pts.iter().map(|q| (q.x - m.x) * (q.y - m.y)).sum::<f64>();
            let t = 0.5 * (2. * xy).atan2(xx - yy);
            let mut d = p(t.cos(), t.sin());
            let direction = if before {
                p(
                    pts[0].x - pts[pts.len() - 1].x,
                    pts[0].y - pts[pts.len() - 1].y,
                )
            } else {
                p(
                    pts[pts.len() - 1].x - pts[0].x,
                    pts[pts.len() - 1].y - pts[0].y,
                )
            };
            if d.x * direction.x + d.y * direction.y < 0. {
                d.x = -d.x;
                d.y = -d.y;
            }
            (m, d)
        };
        let mut turns = [0.; 3];
        let mut intersections = Vec::new();
        for (k, scale) in scales.into_iter().enumerate() {
            let (a, u) = arm(true, scale);
            let (b, v) = arm(false, scale);
            turns[k] = (u.x * v.x + u.y * v.y).clamp(-1., 1.).acos();
            let det = u.x * v.y - u.y * v.x;
            if k > 0 && det.abs() > 0.05 {
                let t = ((b.x - a.x) * v.y - (b.y - a.y) * v.x) / det;
                intersections.push(p(a.x + t * u.x, a.y + t * u.y));
            }
        }
        let lo = turns.into_iter().fold(f64::INFINITY, f64::min);
        let hi = turns.into_iter().fold(0., f64::max);
        let stable = lo / hi.max(0.01);
        let estimate =
            if intersections.len() == 2 && distance(intersections[0], intersections[1]) < 0.9 {
                p(
                    (intersections[0].x + intersections[1].x) * 0.5,
                    (intersections[0].y + intersections[1].y) * 0.5,
                )
            } else {
                q
            };
        let localized = intersections.len() == 2
            && distance(estimate, q) < 1.8
            && distance(intersections[0], intersections[1]) < 0.9;
        let confidence =
            (stable * (lo / 1.2).min(1.) / (1. + distance(estimate, q) * 0.2)).clamp(0., 1.);
        let class = if junction {
            4
        } else if !seg.is_ring() && (i < 10 || i + 10 >= n) {
            5
        } else if lo > 0.5 && stable > 0.72 && localized {
            0
        } else if lo > 0.35 && stable > 0.6 {
            1
        } else if hi < 0.12 {
            3
        } else if stable < 0.25 && hi > 0.8 {
            5
        } else {
            2
        };
        out.push(Corner {
            index: i,
            class,
            confidence: if junction { 1. } else { confidence },
            position: if class == 0 { estimate } else { q },
            protected: junction,
        });
    }
    // Nonmaximum suppression prevents locking a band of staircase vertices.
    let candidates: Vec<_> = out
        .iter()
        .filter(|c| c.class == 0)
        .map(|c| c.index)
        .collect();
    for &i in &candidates {
        let keep = (-3isize..=3).all(|offset| {
            let j = if seg.is_ring() {
                (i as isize + offset).rem_euclid(n as isize) as usize
            } else {
                (i as isize + offset).clamp(0, n as isize - 1) as usize
            };
            out[j].class != 0
                || i == j
                || out[i].confidence > out[j].confidence
                || out[i].confidence == out[j].confidence && i < j
        });
        out[i].protected |= keep;
    }
    out
}
fn ellipse(seg: &Segment, corners: &[Corner]) -> Option<FittedGeom> {
    if !seg.is_ring() || corners.iter().any(|c| c.protected) {
        return None;
    }
    let ps = &seg.points;
    let x0 = ps.iter().map(|q| q.x).min()? as f64;
    let x1 = ps.iter().map(|q| q.x).max()? as f64;
    let y0 = ps.iter().map(|q| q.y).min()? as f64;
    let y1 = ps.iter().map(|q| q.y).max()? as f64;
    let mut rx = (x1 - x0) / 2.;
    let mut ry = (y1 - y0) / 2.;
    if rx < 3. || ry < 3. || rx / ry < 0.3 || rx / ry > 3. {
        return None;
    }
    let cx = (x0 + x1) / 2.;
    let cy = (y0 + y1) / 2.;
    let mut error = 0.;
    let mut quadrants = [0usize; 4];
    for q in ps {
        let x = (q.x as f64 - cx) / rx;
        let y = (q.y as f64 - cy) / ry;
        let e = (x.hypot(y) - 1.).abs();
        if e > 0.12 {
            return None;
        }
        error += e * e;
        quadrants[(x > 0.) as usize + 2 * (y > 0.) as usize] += 1;
    }
    if (error / ps.len() as f64).sqrt() > 0.045 || quadrants.iter().any(|&n| n < ps.len() / 10) {
        return None;
    }
    // Robust radius scale, rather than treating the extremal crack as the curve.
    let mut radii: Vec<_> = ps
        .iter()
        .map(|q| ((q.x as f64 - cx) / rx).hypot((q.y as f64 - cy) / ry))
        .collect();
    radii.sort_by(f64::total_cmp);
    let scale = radii[radii.len() / 2];
    rx *= scale;
    ry *= scale;
    // Four standard cubic quarter-ellipses, traversal matches signed crack area.
    let k = 0.5522847498307936;
    let mut curves = vec![
        [
            p(cx + rx, cy),
            p(cx + rx, cy + k * ry),
            p(cx + k * rx, cy + ry),
            p(cx, cy + ry),
        ],
        [
            p(cx, cy + ry),
            p(cx - k * rx, cy + ry),
            p(cx - rx, cy + k * ry),
            p(cx - rx, cy),
        ],
        [
            p(cx - rx, cy),
            p(cx - rx, cy - k * ry),
            p(cx - k * rx, cy - ry),
            p(cx, cy - ry),
        ],
        [
            p(cx, cy - ry),
            p(cx + k * rx, cy - ry),
            p(cx + rx, cy - k * ry),
            p(cx + rx, cy),
        ],
    ];
    let area: i64 = ps
        .windows(2)
        .map(|w| w[0].x as i64 * w[1].y as i64 - w[1].x as i64 * w[0].y as i64)
        .sum();
    if area < 0 {
        curves = curves
            .into_iter()
            .rev()
            .map(|c| [c[3], c[2], c[1], c[0]])
            .collect()
    }
    Some(FittedGeom::Beziers(curves))
}
pub fn fit(seg: &Segment, edge: usize, img: Option<&ColorImage>) -> Option<FittedGeom> {
    let corners = detect(seg);
    RECORDS.with(|r| {
        let mut r = r.borrow_mut();
        for c in corners.iter().filter(|c| c.protected || c.index % 8 == 0) {
            if r.len() >= 7 * 4096 {
                break;
            }
            let mut confidence = c.confidence;
            // Alpha edges do not provide reliable opaque two-color corner evidence.
            if let Some(img) = img {
                let x = (c.position.x as usize).min(img.width - 1);
                let y = (c.position.y as usize).min(img.height - 1);
                if img.pixels[(y * img.width + x) * 4 + 3] < 255 {
                    confidence *= 0.5;
                }
            }
            r.extend([
                edge as f64,
                c.index as f64,
                c.class as f64,
                confidence,
                c.position.x,
                c.position.y,
                c.protected as u8 as f64,
            ]);
        }
    });
    if let Some(e) = ellipse(seg, &corners) {
        return Some(e);
    }
    let mut cuts: Vec<_> = corners
        .iter()
        .filter(|c| c.protected)
        .map(|c| c.index)
        .collect();
    let last = seg.points.len() - 1;
    if seg.is_ring() {
        if cuts.is_empty() {
            return fit_smooth_ring(seg);
        }
        let start = cuts[0];
        let mut rotated = seg.clone();
        rotated.points = (0..=last).map(|i| seg.points[(start + i) % last]).collect();
        cuts = cuts
            .into_iter()
            .map(|i| (i + last - start) % last)
            .collect();
        cuts.sort_unstable();
        cuts.push(last);
        let positions: Vec<_> = corners
            .iter()
            .filter(|c| c.protected)
            .map(|c| c.position)
            .collect();
        return fit_pieces(&rotated, &cuts, &positions);
    }
    if cuts.first() != Some(&0) {
        cuts.insert(0, 0)
    }
    if cuts.last() != Some(&last) {
        cuts.push(last)
    }
    let positions: Vec<_> = cuts
        .iter()
        .map(|i| {
            corners.iter().find(|c| c.index == *i).map_or_else(
                || p(seg.points[*i].x as f64, seg.points[*i].y as f64),
                |c| c.position,
            )
        })
        .collect();
    fit_pieces(seg, &cuts, &positions)
}
fn smooth(raw: &[PointF64], closed: bool) -> Vec<PointF64> {
    (0..raw.len())
        .map(|i| {
            if !closed && (i == 0 || i + 1 == raw.len()) {
                return raw[i];
            }
            let mut q = p(0., 0.);
            let mut sum = 0.;
            for (k, w) in [1., 2., 3., 2., 1.].into_iter().enumerate() {
                let j = i as isize + k as isize - 2;
                let j = if closed {
                    j.rem_euclid(raw.len() as isize) as usize
                } else {
                    j.clamp(0, raw.len() as isize - 1) as usize
                };
                q.x += w * raw[j].x;
                q.y += w * raw[j].y;
                sum += w;
            }
            p(q.x / sum, q.y / sum)
        })
        .collect()
}
fn fit_smooth_ring(seg: &Segment) -> Option<FittedGeom> {
    let n = seg.points.len() - 1;
    if n < 8 {
        return None;
    }
    let raw: Vec<_> = seg.points[..n]
        .iter()
        .map(|q| p(q.x as f64, q.y as f64))
        .collect();
    let ps = smooth(&raw, true);
    let mut out = Vec::new();
    let tangent = |i: usize| {
        let a = ps[(i + n - 3) % n];
        let b = ps[(i + 3) % n];
        let d = distance(a, b).max(1e-12);
        Coord2((b.x - a.x) / d, (b.y - a.y) / d)
    };
    for (a, b) in [(0, n / 2), (n / 2, n)] {
        let data: Vec<_> = (a..=b).map(|i| Coord2(ps[i % n].x, ps[i % n].y)).collect();
        let t = tangent(b % n);
        let curves: Vec<Curve<Coord2>> =
            fit_curve_cubic(&data, &tangent(a), &Coord2(-t.0, -t.1), 0.4);
        for c in curves {
            out.push([
                p(c.start_point.0, c.start_point.1),
                p(c.control_points.0.0, c.control_points.0.1),
                p(c.control_points.1.0, c.control_points.1.1),
                p(c.end_point.0, c.end_point.1),
            ]);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(FittedGeom::Beziers(out))
    }
}
fn fit_pieces(seg: &Segment, cuts: &[usize], positions: &[PointF64]) -> Option<FittedGeom> {
    let mut curves = Vec::new();
    let mut polygon = Vec::new();
    let mut all_straight = true;
    for (piece_id, w) in cuts.windows(2).enumerate() {
        let mut piece = seg.clone();
        piece.points = seg.points[w[0]..=w[1]].to_vec();
        piece.start = Some(0);
        piece.end = Some(0);
        let raw: Vec<_> = piece
            .points
            .iter()
            .map(|q| p(q.x as f64, q.y as f64))
            .collect();
        let mut ps = smooth(&raw, false);
        ps[0] = positions[piece_id];
        let last = ps.len() - 1;
        ps[last] = positions[(piece_id + 1) % positions.len()];
        if ps.len() < 2 {
            return None;
        }
        let a = ps[0];
        let b = *ps.last()?;
        let len = distance(a, b).max(1e-12);
        let straight = raw
            .iter()
            .all(|q| ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)).abs() / len <= 1.0);
        all_straight &= straight;
        if polygon.is_empty() {
            polygon.push(a)
        }
        polygon.push(b);
        let tolerance = if ps.len() < 16 { 0.3 } else { 0.5 };
        let data: Vec<_> = ps.iter().map(|q| Coord2(q.x, q.y)).collect();
        let unit = |a: PointF64, b: PointF64| {
            let d = distance(a, b).max(1e-12);
            Coord2((b.x - a.x) / d, (b.y - a.y) / d)
        };
        let fitted: Vec<Curve<Coord2>> = fit_curve_cubic(
            &data,
            &unit(ps[0], ps[1]),
            &unit(ps[ps.len() - 1], ps[ps.len() - 2]),
            tolerance,
        );
        for c in fitted {
            let cv = |q: Coord2| p(q.0, q.1);
            curves.push([
                cv(c.start_point),
                cv(c.control_points.0),
                cv(c.control_points.1),
                cv(c.end_point),
            ]);
        }
    }
    if all_straight && polygon.len() > 1 {
        return Some(FittedGeom::Polyline(polygon));
    }
    if curves.is_empty() {
        None
    } else {
        Some(FittedGeom::Beziers(curves))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use vtracer::PointI32;
    fn ring(ps: Vec<PointI32>) -> Segment {
        Segment {
            points: ps,
            start: None,
            end: None,
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        }
    }
    #[test]
    fn square_has_four_protected_corners() {
        let mut ps = Vec::new();
        for i in 0..32 {
            ps.push(PointI32 { x: i, y: 0 })
        }
        for i in 0..32 {
            ps.push(PointI32 { x: 32, y: i })
        }
        for i in (1..=32).rev() {
            ps.push(PointI32 { x: i, y: 32 })
        }
        for i in (0..=32).rev() {
            ps.push(PointI32 { x: 0, y: i })
        }
        let s = ring(ps);
        assert_eq!(detect(&s).iter().filter(|c| c.protected).count(), 4);
    }
    #[test]
    fn diagonal_staircase_is_not_a_corner() {
        let mut ps = Vec::new();
        for i in 0..40 {
            ps.push(PointI32 { x: i, y: i });
            ps.push(PointI32 { x: i + 1, y: i });
        }
        let mut s = ring(ps);
        s.start = Some(0);
        s.end = Some(1);
        assert_eq!(detect(&s).iter().filter(|c| c.protected).count(), 2);
    }
}
