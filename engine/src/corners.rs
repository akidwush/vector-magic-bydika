//! Multi-scale evidence over upstream crack chains; geometry fitting uses flo_curves
//! (the same Schneider implementation used by VTracer SimplifyCurves).
use flo_curves::{
    Coord2,
    bezier::{Curve, fit_curve_cubic},
};
use std::cell::RefCell;
use vtracer::{
    ColorImage, PointF64,
    mosaic::{FittedGeom, PolygonSegmentFitter, Segment, SegmentFitter},
};
thread_local! {static RECORDS:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub fn reset() {
    RECORDS.with(|r| r.borrow_mut().clear());
}
pub fn evidence() -> Vec<f64> {
    RECORDS.with(|r| r.borrow().clone())
}
pub fn restore(data: Vec<f64>) {
    RECORDS.with(|r| *r.borrow_mut() = data);
}
fn p(x: f64, y: f64) -> PointF64 {
    PointF64 { x, y }
}
fn distance(a: PointF64, b: PointF64) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn angle(a: PointF64, b: PointF64, c: PointF64) -> f64 {
    let u = p(b.x - a.x, b.y - a.y);
    let v = p(c.x - b.x, c.y - b.y);
    ((u.x * v.x + u.y * v.y) / (u.x.hypot(u.y) * v.x.hypot(v.y)).max(1e-12))
        .clamp(-1., 1.)
        .acos()
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
        let scales = [2usize, 4, 8].map(|s| s.min((n / 4).max(1)));
        let turns =
            scales.map(|s| angle(at(i as isize - s as isize), q, at(i as isize + s as isize)));
        let lo = turns.into_iter().fold(f64::INFINITY, f64::min);
        let hi = turns.into_iter().fold(0., f64::max);
        let stable = lo / hi.max(0.01);
        let confidence = (stable * (lo / 1.2).min(1.)).clamp(0., 1.);
        let class = if junction {
            4
        } else if !seg.is_ring() && (i < 8 || i + 8 >= n) {
            5
        } else if lo > 0.65 && stable > 0.78 {
            0
        } else if lo > 0.35 && stable > 0.65 {
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
            position: q,
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
            return None;
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
        return fit_pieces(&rotated, &cuts);
    }
    if cuts.first() != Some(&0) {
        cuts.insert(0, 0)
    }
    if cuts.last() != Some(&last) {
        cuts.push(last)
    }
    fit_pieces(seg, &cuts)
}
fn fit_pieces(seg: &Segment, cuts: &[usize]) -> Option<FittedGeom> {
    let mut curves = Vec::new();
    let mut polygon = Vec::new();
    let mut all_straight = true;
    for w in cuts.windows(2) {
        let mut piece = seg.clone();
        piece.points = seg.points[w[0]..=w[1]].to_vec();
        piece.start = Some(0);
        piece.end = Some(0);
        let FittedGeom::Polyline(ps) = PolygonSegmentFitter.fit_open(&piece).geom else {
            return None;
        };
        if ps.len() < 2 {
            return None;
        }
        let a = ps[0];
        let b = *ps.last()?;
        let len = distance(a, b).max(1e-12);
        let straight = ps
            .iter()
            .all(|q| ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)).abs() / len <= 0.7);
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
