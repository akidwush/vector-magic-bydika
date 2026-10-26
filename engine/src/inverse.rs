//! Experimental source-constrained refinement. VTracer supplies all contours;
//! existing flo_curves supplies initialization. No segmentation or tracer here.
use crate::source_fit::Sample;
use std::{cell::RefCell, collections::HashMap};
use vtracer::{
    ColorImage, PointF64 as P,
    mosaic::{FittedGeom as G, Segment},
};
#[derive(Default)]
struct Stats {
    #[cfg(feature = "source_geometry")]
    deferred: bool,
    targets: u32,
    target_steps: u32,
    target_ms: f64,
    enabled: bool,
    attempts: u32,
    accepted: u32,
    evaluations: u32,
    before: f64,
    after: f64,
    ms: f64,
    phase: u32,
    initialized: f64,
    inspections: u32,
}
thread_local! {static LAST:RefCell<Stats>=RefCell::new(Stats::default());}
pub fn reset(enabled: bool) {
    #[cfg(feature = "source_geometry")]
    crate::recovery::reset();
    REPLACEMENTS.with(|r| r.borrow_mut().clear());
    LAST.with(|s| {
        *s.borrow_mut() = Stats {
            enabled,
            ..Stats::default()
        }
    });
}
pub fn enabled() -> bool {
    LAST.with(|s| s.borrow().enabled)
}
pub fn values() -> Vec<f64> {
    LAST.with(|s| {
        let s = s.borrow();
        vec![
            s.attempts as f64,
            s.accepted as f64,
            s.evaluations as f64,
            s.before,
            s.after,
            s.ms,
            s.phase as f64,
            s.initialized,
            s.inspections as f64,
            s.targets as f64,
            s.target_steps as f64,
            s.target_ms,
        ]
    })
}
#[cfg(target_arch = "wasm32")]
fn now() -> f64 {
    crate::now()
}
#[cfg(not(target_arch = "wasm32"))]
fn now() -> f64 {
    0.
}
fn distance(a: P, b: P) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
// Exact integral of clamp(linear x(y)-pixel_x,0,1), over a clipped y interval.
#[cfg(feature = "inverse_hotpath")]
mod hotpath;
fn clamped_integral(a: f64, b: f64, dy: f64) -> f64 {
    inverse_count!(1, 1);
    #[cfg(feature = "inverse_hotpath")]
    {
        hotpath::clamped_integral(a, b, dy)
    }
    #[cfg(not(feature = "inverse_hotpath"))]
    {
        clamped_integral_legacy(a, b, dy)
    }
}
#[cfg(any(test, not(feature = "inverse_hotpath")))]
fn clamped_integral_legacy(a: f64, b: f64, dy: f64) -> f64 {
    if (a - b).abs() < 1e-12 {
        return a.clamp(0., 1.) * dy;
    }
    // Integrate piecewise at clamp breakpoints. Avoid subtracting large
    // antiderivatives for edges far outside the pixel (catastrophic cancellation).
    inverse_count!(2, 1);
    let mut knots = vec![0., 1.];
    for boundary in [0., 1.] {
        let t = (boundary - a) / (b - a);
        if t > 0. && t < 1. {
            knots.push(t);
        }
    }
    knots.sort_by(f64::total_cmp);
    knots
        .windows(2)
        .map(|w| {
            let value = |t: f64| (a + (b - a) * t).clamp(0., 1.);
            (w[1] - w[0]) * (value(w[0]) + value(w[1])) * 0.5 * dy
        })
        .sum()
}
/// Polygon/pixel intersection area via Green's theorem. Horizontal extent is
/// integrated analytically; unlike 4x4/16x16 occupancy, no coverage staircase.
pub fn coverages(poly: &[P], ss: &[Sample]) -> Option<Vec<f64>> {
    if poly.len() < 4 {
        return None;
    }
    Some(
        signed_edge_areas(poly, ss)?
            .into_iter()
            .map(|v| v.abs().clamp(0., 1.))
            .collect(),
    )
}
/// Directed open-chain contributions, for caching unchanged edges. No abs/clamp
/// until all chains are summed; uses the identical validated Green integral.
pub(crate) fn signed_edge_areas(poly: &[P], ss: &[Sample]) -> Option<Vec<f64>> {
    runtime_scope!(16);
    #[cfg(feature = "inverse_hotpath")]
    {
        hotpath::signed_edge_areas(poly, ss)
    }
    #[cfg(not(feature = "inverse_hotpath"))]
    {
        signed_edge_areas_legacy(poly, ss)
    }
}
#[cfg(any(test, not(feature = "inverse_hotpath")))]
fn signed_edge_areas_legacy(poly: &[P], ss: &[Sample]) -> Option<Vec<f64>> {
    if poly.len() < 2
        || poly.len() > 32768
        || poly.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return None;
    }
    let mut rows: HashMap<i32, Vec<(P, P)>> = HashMap::new();
    for s in ss {
        rows.entry(s.y).or_default();
    }
    inverse_count!(3, ss.len());
    inverse_count!(12, rows.len());
    let mut count = 0;
    for w in poly.windows(2) {
        let (a, b) = (w[0], w[1]);
        if (b.y - a.y).abs() < 1e-12 {
            continue;
        }
        if (a.y - b.y).abs() > 4096. {
            return None;
        }
        for y in a.y.min(b.y).floor() as i32..b.y.max(a.y).ceil() as i32 {
            if let Some(row) = rows.get_mut(&y) {
                count += 1;
                inverse_count!(4, 1);
                if count > 65536 {
                    return None;
                }
                row.push((a, b));
            }
        }
    }
    Some(
        ss.iter()
            .map(|s| {
                let mut area = 0.;
                for &(a, b) in &rows[&s.y] {
                    let lo = a.y.min(b.y).max(s.y as f64);
                    let hi = a.y.max(b.y).min(s.y as f64 + 1.);
                    if hi <= lo {
                        continue;
                    }
                    let x = |y| a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y) - s.x as f64;
                    area += (b.y - a.y).signum() * clamped_integral(x(lo), x(hi), hi - lo);
                }
                area
            })
            .collect(),
    )
}
pub(crate) fn flatten(g: &G, tolerance: f64) -> Option<Vec<P>> {
    runtime_scope!(15);
    fn split(c: [P; 4], tol: f64, depth: u8, out: &mut Vec<P>) -> Option<()> {
        if out.len() > 8192 {
            return None;
        }
        let d = distance(c[0], c[3]);
        let error = |q: P| {
            if d < 1e-12 {
                return distance(q, c[0]);
            }
            let t = (((q.x - c[0].x) * (c[3].x - c[0].x) + (q.y - c[0].y) * (c[3].y - c[0].y))
                / (d * d))
                .clamp(0., 1.);
            distance(
                q,
                P {
                    x: c[0].x + t * (c[3].x - c[0].x),
                    y: c[0].y + t * (c[3].y - c[0].y),
                },
            )
        };
        if error(c[1]).max(error(c[2])) <= tol {
            out.push(c[3]);
            return Some(());
        }
        if depth >= 18 {
            return None;
        }
        let mid = |a: P, b: P| P {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
        };
        let a = mid(c[0], c[1]);
        let b = mid(c[1], c[2]);
        let d = mid(c[2], c[3]);
        let e = mid(a, b);
        let f = mid(b, d);
        let m = mid(e, f);
        split([c[0], a, e, m], tol, depth + 1, out)?;
        split([m, f, d, c[3]], tol, depth + 1, out)
    }
    match g {
        G::Polyline(ps) => Some(ps.clone()),
        G::Beziers(cs) => {
            inverse_count!(5, cs.len());
            let mut out = vec![cs.first()?[0]];
            for c in cs {
                split(*c, tolerance, 0, &mut out)?;
            }
            inverse_count!(6, out.len());
            Some(out)
        }
    }
}
fn loss(g: &G, ss: &[Sample], tol: f64) -> f64 {
    inverse_scope!(0);
    inverse_count!(14, ss.len());
    runtime_count!(29, 1);
    LAST.with(|s| s.borrow_mut().evaluations += 1);
    let Some(p) = flatten(g, tol) else {
        return f64::INFINITY;
    };
    let Some(values) = coverages(&p, ss) else {
        return f64::INFINITY;
    };
    coverage_loss(&values, ss)
}
fn coverage_loss(values: &[f64], ss: &[Sample]) -> f64 {
    values
        .iter()
        .zip(ss)
        .map(|(a, b)| {
            let d = (a - b.coverage).abs();
            if d < 0.2 { d * d } else { 0.4 * d - 0.04 }
        })
        .sum::<f64>()
        / ss.len().max(1) as f64
}
fn round(g: &mut G) {
    if let G::Beziers(cs) = g {
        for p in cs.iter_mut().flatten() {
            p.x = (p.x * 100.).round() / 100.;
            p.y = (p.y * 100.).round() / 100.;
        }
    }
}
/// Preserve actual output tangent discontinuities with substantial support;
/// tiny raster splice connectors do not become new protected feature claims.
pub(crate) fn endpoint_tangents(c: &[P; 4]) -> (P, P) {
    let end = if distance(c[3], c[2]) > 1e-8 {
        c[2]
    } else if distance(c[3], c[1]) > 1e-8 {
        c[1]
    } else {
        c[0]
    };
    let start = if distance(c[0], c[1]) > 1e-8 {
        c[1]
    } else if distance(c[0], c[2]) > 1e-8 {
        c[2]
    } else {
        c[3]
    };
    (
        P {
            x: start.x - c[0].x,
            y: start.y - c[0].y,
        },
        P {
            x: c[3].x - end.x,
            y: c[3].y - end.y,
        },
    )
}
fn corners(g: &G) -> Vec<P> {
    let G::Beziers(cs) = g else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for i in 0..cs.len() {
        let a = cs[(i + cs.len() - 1) % cs.len()];
        let b = cs[i];
        if distance(a[0], a[3]) < 3. || distance(b[0], b[3]) < 3. {
            continue;
        }
        let (_, u) = endpoint_tangents(&a);
        let (v, _) = endpoint_tangents(&b);
        let n = u.x.hypot(u.y) * v.x.hypot(v.y);
        if n > 1e-8 && ((u.x * v.x + u.y * v.y) / n).clamp(-1., 1.).acos() > 0.65 {
            out.push(b[0]);
        }
    }
    out
}
pub(crate) fn displacement_bound(a: &G, b: &G, limit: f64) -> bool {
    runtime_scope!(17);
    let a = crate::planar::flatten(a);
    let b = crate::planar::flatten(b);
    let mut checks = 0usize;
    let mut samples = 0usize;
    for (source, target) in [(&a, &b), (&b, &a)] {
        let mut grid: HashMap<(i32, i32), Vec<(P, P)>> = HashMap::new();
        for w in target.windows(2) {
            if ![w[0], w[1]]
                .iter()
                .all(|p| p.x.is_finite() && p.y.is_finite())
            {
                return false;
            }
            for y in
                (w[0].y.min(w[1].y) / 2.).floor() as i32..=(w[0].y.max(w[1].y) / 2.).floor() as i32
            {
                for x in (w[0].x.min(w[1].x) / 2.).floor() as i32
                    ..=(w[0].x.max(w[1].x) / 2.).floor() as i32
                {
                    grid.entry((x, y)).or_default().push((w[0], w[1]));
                }
            }
        }
        let radius = (limit / 2.).ceil() as i32;
        for w in source.windows(2) {
            let n = (distance(w[0], w[1]) / 0.5).ceil().max(1.) as usize;
            for i in 0..=n {
                samples += 1;
                if samples > 32768 {
                    return false;
                }
                let t = i as f64 / n as f64;
                let q = P {
                    x: w[0].x + (w[1].x - w[0].x) * t,
                    y: w[0].y + (w[1].y - w[0].y) * t,
                };
                let key = ((q.x / 2.).floor() as i32, (q.y / 2.).floor() as i32);
                let mut found = false;
                'cells: for y in -radius..=radius {
                    for x in -radius..=radius {
                        if let Some(edges) = grid.get(&(key.0 + x, key.1 + y)) {
                            for &(u, v) in edges {
                                checks += 1;
                                if checks > 2_000_000 {
                                    return false;
                                }
                                let dx = v.x - u.x;
                                let dy = v.y - u.y;
                                let n = dx * dx + dy * dy;
                                let t = if n > 1e-16 {
                                    (((q.x - u.x) * dx + (q.y - u.y) * dy) / n).clamp(0., 1.)
                                } else {
                                    0.
                                };
                                if distance(
                                    q,
                                    P {
                                        x: u.x + t * dx,
                                        y: u.y + t * dy,
                                    },
                                ) <= limit - 0.254
                                {
                                    found = true;
                                    break 'cells;
                                }
                            }
                        }
                    }
                }
                if !found {
                    return false;
                }
            }
        }
    }
    true
}
thread_local! {static REPLACEMENTS:RefCell<Vec<(vtracer::ir::SubPath,vtracer::ir::SubPath)>>=const{RefCell::new(Vec::new())};}
pub(crate) fn remember(new: vtracer::ir::SubPath, old: vtracer::ir::SubPath) {
    REPLACEMENTS.with(|r| r.borrow_mut().push((new, old)));
}
pub fn repair(doc: &mut vtracer::ir::VectorDoc) -> Result<(), String> {
    if !enabled() {
        return Ok(());
    }
    let changes = REPLACEMENTS.with(|r| r.borrow().clone());
    for (new, old) in changes {
        let mut locations = Vec::new();
        for (i, s) in doc.shapes.iter().enumerate() {
            for (j, p) in s.path.subpaths.iter().enumerate() {
                if *p == new {
                    locations.push((i, j));
                }
            }
        }
        if locations.is_empty() {
            return Err("Source-refined contour ownership could not be verified".into());
        }
        if locations.len() > 1 {
            // Equal geometry does not prove equal ownership: another layer
            // may already have this path. Rewriting every match would corrupt
            // unrelated objects rather than reliably rolling this one back.
            return Err("Source-refined contour ownership is ambiguous".into());
        }
        let (i, j) = locations[0];
        let others: Vec<_> = doc
            .shapes
            .iter()
            .enumerate()
            .flat_map(|(si, s)| {
                s.path
                    .subpaths
                    .iter()
                    .enumerate()
                    .filter(move |(pj, _)| si != i || *pj != j)
                    .filter_map(|(_, p)| crate::source_fit::from_path(p))
            })
            .collect();
        if let Some(g) = crate::source_fit::from_path(&new) {
            let old_g = crate::source_fit::from_path(&old).ok_or("Invalid rollback geometry")?;
            let a = crate::planar::flatten(&old_g);
            let b = crate::planar::flatten(&g);
            let containment_changed = others.iter().any(|o| {
                crate::planar::flatten(o)
                    .first()
                    .is_some_and(|p| crate::reduce::inside(&a, *p) != crate::reduce::inside(&b, *p))
            });
            if containment_changed || !crate::planar::replacement_clear(&g, &others) {
                doc.shapes[i].path.subpaths[j] = old;
                undo();
            }
        }
    }
    Ok(())
}
pub fn undo() {
    LAST.with(|s| {
        let mut s = s.borrow_mut();
        s.accepted = s.accepted.saturating_sub(1);
        if s.accepted == 0 {
            s.before = 0.;
            s.after = 0.;
            s.initialized = 0.;
        }
    });
}
pub fn claim_support() -> bool {
    LAST.with(|s| {
        let mut s = s.borrow_mut();
        if !s.enabled || s.inspections >= 8 || s.attempts >= 4 {
            false
        } else {
            s.inspections += 1;
            true
        }
    })
}
pub fn component(mask: &vtracer::ir::RegionMask, img: &ColorImage, baseline: Vec<G>) -> Vec<G> {
    if !enabled() || baseline.len() != 1 || mask.width().min(mask.height()) < 12 {
        return baseline;
    }
    let G::Beziers(cs) = &baseline[0] else {
        return baseline;
    };
    if cs.len() <= 4 || mask.width().max(mask.height()) <= 32 || !claim_support() {
        return baseline;
    }
    if let Some((seg, ss)) = crate::source_fit::inverse_support(mask, img) {
        let reference = crate::source_fit::inverse_reference(&baseline[0], img)
            .unwrap_or_else(|| baseline[0].clone());
        if let Some(model) = refine(&seg, img, &reference, &ss) {
            if let Some(model) = crate::source_fit::protect_inverse(model, &baseline[0], img) {
                #[cfg(feature = "source_geometry")]
                crate::recovery::capture(&model, &seg, &ss);
                return vec![model];
            }
        }
        // A low mean loss can hide a missing acute cap. Keep the existing
        // global fit guard; defer only this source-supported case to final knots.
        #[cfg(feature = "source_geometry")]
        if LAST.with(|s| s.borrow().deferred) {
            crate::recovery::capture_deferred(&baseline[0], &seg, &ss);
        }
    }
    baseline
}
pub fn refine(seg: &Segment, img: &ColorImage, old: &G, ss: &[Sample]) -> Option<G> {
    runtime_scope!(4);
    #[cfg(feature = "source_geometry")]
    LAST.with(|s| s.borrow_mut().deferred = false);
    if !enabled() || !seg.is_ring() || ss.len() < 32 || ss.len() > 8192 {
        return None;
    }
    let G::Beziers(cs) = old else {
        return None;
    };
    let span = |axis: bool| {
        let vs: Vec<_> = seg
            .points
            .iter()
            .map(|p| if axis { p.x } else { p.y })
            .collect();
        vs.iter().max().unwrap_or(&0) - vs.iter().min().unwrap_or(&0)
    };
    if span(true).max(span(false)) <= 32
        || cs.len() <= 4
        || cs.len() > 128
        || seg.points.len() > 8192
    {
        return None;
    }
    let allowed = LAST.with(|s| {
        let mut s = s.borrow_mut();
        if s.attempts >= 4 {
            false
        } else {
            s.attempts += 1;
            true
        }
    });
    if !allowed {
        return None;
    }
    let start = now();
    let result = (|| {
        LAST.with(|s| s.borrow_mut().phase = 1);
        let before = loss(old, ss, 0.01);
        #[cfg(feature = "source_geometry")]
        crate::recovery::observe_initialization(before, seg, ss, cs.len());
        // A localized low-coverage cap alone is too weak to justify replacing
        // an otherwise well-reconstructed contour. Keep the stable baseline.
        if before < 0.008 {
            #[cfg(feature = "source_geometry")]
            LAST.with(|s| {
                let mut s = s.borrow_mut();
                s.phase = 8;
                s.deferred = true;
            });
            return None;
        }
        let movement = (img.width.max(img.height) as f64 * 0.012).clamp(4., 12.);
        let source_corners: Vec<_> = crate::corners::detect_source(seg)
            .into_iter()
            .filter(|c| c.protected && c.confidence >= 0.5)
            .collect();
        let fixed: Vec<_> = corners(old)
            .into_iter()
            .filter(|p| {
                source_corners
                    .iter()
                    .any(|q| distance(*p, q.position) < movement)
            })
            .collect();
        // Reuse upstream crack-chain corner fitter to repair a poor initialization.
        let mut candidate = {
            inverse_scope!(11);
            crate::corners::fit_source(seg, 0, Some(img), &fixed)?
        };
        LAST.with(|s| s.borrow_mut().phase = 2);
        let G::Beziers(ref curves) = candidate else {
            return None;
        };

        if curves.len() > 128 || curves.len() > cs.len() * 4 + 16 {
            return None;
        }
        LAST.with(|s| s.borrow_mut().phase = 3);
        if !crate::planar::valid_model(seg, &candidate, img.width as u32, img.height as u32) {
            return None;
        }
        LAST.with(|s| s.borrow_mut().phase = 4);
        let found = corners(&candidate);
        if fixed
            .iter()
            .any(|p| !found.iter().any(|q| distance(*p, *q) < movement))
        {
            return None;
        }
        LAST.with(|s| s.borrow_mut().phase = 5);
        round(&mut candidate);
        let mut best = loss(&candidate, ss, 0.01);
        if best >= before * 0.9 {
            return None;
        }
        let initial_candidate = candidate.clone();
        let initial_loss = loss(&candidate, ss, 0.001);
        // Local handles only. Anchors/corner discontinuities and joins are locked.
        let G::Beziers(init) = candidate.clone() else {
            return None;
        };
        let mut ranked: Vec<_> = (0..init.len())
            .map(|i| {
                let c = init[i];
                let lo_x = c.iter().map(|p| p.x).fold(f64::INFINITY, f64::min) - 2.;
                let hi_x = c.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max) + 2.;
                let lo_y = c.iter().map(|p| p.y).fold(f64::INFINITY, f64::min) - 2.;
                let hi_y = c.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max) + 2.;
                let local: Vec<_> = ss
                    .iter()
                    .filter(|s| {
                        s.x as f64 >= lo_x
                            && (s.x as f64) <= hi_x
                            && s.y as f64 >= lo_y
                            && (s.y as f64) <= hi_y
                    })
                    .cloned()
                    .collect();
                let error = loss(&candidate, &local, 0.02);
                (i, error, local)
            })
            .collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
        for (i, _, local) in ranked.into_iter().take(4) {
            if local.len() < 8 {
                continue;
            }
            #[cfg(feature = "inverse_hotpath")]
            let mut local_loss = hotpath::LocalLoss::new(&local);
            for step in [0.4, 0.15, 0.05] {
                for handle in [1, 2] {
                    for _ in 0..1 {
                        let G::Beziers(current) = &candidate else {
                            unreachable!()
                        };
                        #[cfg(feature = "inverse_hotpath")]
                        let local_value = local_loss.score(&candidate, 0.01);
                        #[cfg(not(feature = "inverse_hotpath"))]
                        let local_value = loss(&candidate, &local, 0.01);
                        let local_best = local_value
                            + 1e-6 * distance(current[i][handle], init[i][handle]).powi(2);
                        let mut chosen = candidate.clone();
                        let mut chosen_loss = local_best;
                        for sign in [-1., 1.] {
                            let mut trial = candidate.clone();
                            let G::Beziers(ref mut c) = trial else {
                                unreachable!()
                            };
                            let anchor = if handle == 1 { init[i][0] } else { init[i][3] };
                            let len = distance(anchor, init[i][handle]);
                            if len < 1e-6 {
                                continue;
                            }
                            c[i][handle].x += sign * step * (init[i][handle].x - anchor.x) / len;
                            c[i][handle].y += sign * step * (init[i][handle].y - anchor.y) / len;
                            if distance(c[i][handle], init[i][handle]) > 1.0 {
                                continue;
                            }
                            let regularization =
                                1e-6 * distance(c[i][handle], init[i][handle]).powi(2);
                            #[cfg(feature = "inverse_hotpath")]
                            let value = local_loss.score(&trial, 0.01) + regularization;
                            #[cfg(not(feature = "inverse_hotpath"))]
                            let value = loss(&trial, &local, 0.01) + regularization;
                            if value < chosen_loss {
                                chosen_loss = value;
                                chosen = trial;
                            }
                        }
                        candidate = chosen;
                    }
                }
            }
        }
        // Bounded normal-direction experiment: rotate smooth handle pairs
        // together at locked anchors, retaining the direction of a smooth join.
        #[cfg(feature = "experiments")]
        {
            for i in (0..init.len()).step_by((init.len() / 4).max(1)).take(4) {
                for angle in [0.004_f64, 0.002, 0.001, 0.0005] {
                    let mut value = loss(&candidate, ss, 0.001);
                    let mut chosen = candidate.clone();
                    for sign in [-1., 1.] {
                        let mut trial = candidate.clone();
                        let G::Beziers(ref mut cs) = trial else {
                            unreachable!()
                        };
                        let prev = (i + cs.len() - 1) % cs.len();
                        let anchor = cs[i][0];
                        let (v, _) = endpoint_tangents(&cs[i]);
                        let (_, u) = endpoint_tangents(&cs[prev]);
                        let norm = u.x.hypot(u.y) * v.x.hypot(v.y);
                        if norm < 1e-8 || (u.x * v.x + u.y * v.y) / norm < 0.9999 {
                            continue;
                        }
                        let (sn, co) = (sign * angle).sin_cos();
                        for (idx, j) in [(i, 1), (prev, 2)] {
                            let d = P {
                                x: cs[idx][j].x - anchor.x,
                                y: cs[idx][j].y - anchor.y,
                            };
                            cs[idx][j] = P {
                                x: anchor.x + co * d.x - sn * d.y,
                                y: anchor.y + sn * d.x + co * d.y,
                            };
                        }
                        if distance(cs[i][1], init[i][1]) > 1.
                            || distance(cs[prev][2], init[prev][2]) > 1.
                        {
                            continue;
                        }
                        if !crate::planar::valid_model(
                            seg,
                            &trial,
                            img.width as u32,
                            img.height as u32,
                        ) {
                            continue;
                        }
                        let trial_loss = loss(&trial, ss, 0.001);
                        if trial_loss + 1e-9 < value {
                            value = trial_loss;
                            chosen = trial;
                        }
                    }
                    candidate = chosen;
                }
            }
        }
        // Tiny reverse-handled spans are an ill-conditioned spline cap, not
        // evidence of an intended loop. Condition their outgoing tangent using
        // the following span; the complete proposal still needs source gain,
        // unchanged raw-mask drift and collision validation before acceptance.
        if let G::Beziers(ref mut cs) = candidate {
            let original = cs.clone();
            for i in 0..cs.len() {
                let c = original[i];
                let dx = c[3].x - c[0].x;
                let dy = c[3].y - c[0].y;
                let len = distance(c[0], c[3]);
                let reverse = (c[1].x - c[0].x) * dx + (c[1].y - c[0].y) * dy < 0.
                    || (c[3].x - c[2].x) * dx + (c[3].y - c[2].y) * dy < 0.;
                if len > 0.05
                    && len < 2.
                    && reverse
                    && !fixed.iter().any(|p| distance(*p, c[3]) < 0.02)
                {
                    let next = original[(i + 1) % original.len()];
                    let v = P {
                        x: next[1].x - next[0].x,
                        y: next[1].y - next[0].y,
                    };
                    let n = v.x.hypot(v.y);
                    if n > 1e-6 {
                        let k = len / (3. * n);
                        cs[i][1] = P {
                            x: c[0].x + v.x * k,
                            y: c[0].y + v.y * k,
                        };
                        cs[i][2] = P {
                            x: c[3].x - v.x * k,
                            y: c[3].y - v.y * k,
                        };
                    }
                }
            }
        }
        // A very acute cap can have a misplaced anchor despite an accurate
        // surrounding curve. Move the common vertex and its adjacent handles
        // together: hard turn and C0 closure survive, G1 at other knots survives.
        let G::Beziers(ref cs) = candidate else {
            unreachable!()
        };
        let tips: Vec<_> = (0..cs.len())
            .filter(|&i| {
                let prev = cs[(i + cs.len() - 1) % cs.len()];
                let next = cs[i];
                let (_, u) = endpoint_tangents(&prev);
                let (v, _) = endpoint_tangents(&next);
                let n = u.x.hypot(u.y) * v.x.hypot(v.y);
                n > 1e-8 && ((u.x * v.x + u.y * v.y) / n).clamp(-1., 1.).acos() > 2.6
            })
            .take(4)
            .map(|i| (i, cs[i][0]))
            .collect();
        for (i, origin) in tips {
            let local: Vec<_> = ss
                .iter()
                .filter(|s| {
                    (s.x as f64 - origin.x).abs() < 8. && (s.y as f64 - origin.y).abs() < 8.
                })
                .cloned()
                .collect();
            if local.len() < 8 {
                continue;
            }
            for step in [0.8, 0.8, 0.8, 0.4, 0.2, 0.1] {
                for axis in 0..2 {
                    let mut current = loss(&candidate, &local, 0.002);
                    let mut chosen = candidate.clone();
                    for sign in [-1., 1.] {
                        let mut trial = candidate.clone();
                        let G::Beziers(ref mut cs) = trial else {
                            unreachable!()
                        };
                        let prev = (i + cs.len() - 1) % cs.len();
                        for (idx, j) in [(prev, 2), (prev, 3), (i, 0), (i, 1)] {
                            if axis == 0 {
                                cs[idx][j].x += sign * step;
                            } else {
                                cs[idx][j].y += sign * step;
                            }
                        }
                        if distance(cs[i][0], origin) > 2.5 {
                            continue;
                        }
                        let penalty = 1e-6 * distance(cs[i][0], origin).powi(2);
                        let l = loss(&trial, &local, 0.002) + penalty;
                        if l < current
                            && crate::planar::valid_model(
                                seg,
                                &trial,
                                img.width as u32,
                                img.height as u32,
                            )
                        {
                            current = l;
                            chosen = trial;
                        }
                    }
                    candidate = chosen;
                }
            }
        }
        round(&mut candidate);
        best = loss(&candidate, ss, 0.001);
        if best > initial_loss {
            candidate = initial_candidate;
            best = initial_loss;
        }
        let baseline = loss(old, ss, 0.001);
        let count = |g: &G| match g {
            G::Beziers(c) => c.len(),
            G::Polyline(p) => p.len(),
        };
        if best + 1e-6 * count(&candidate) as f64 >= baseline + 1e-6 * count(old) as f64 {
            return None;
        }
        if best + 0.00001 >= baseline * 0.9 || best > 0.01 {
            return None;
        }
        if !crate::planar::valid_model(seg, &candidate, img.width as u32, img.height as u32) {
            return None;
        }
        if !displacement_bound(old, &candidate, movement) {
            return None;
        }
        let found = corners(&candidate);
        if fixed
            .iter()
            .any(|p| !found.iter().any(|q| distance(*p, *q) < movement))
        {
            return None;
        }
        LAST.with(|s| {
            let mut s = s.borrow_mut();
            s.phase = 7;
            s.accepted += 1;
            s.before += baseline;
            s.initialized += initial_loss;
            s.after += best;
        });
        Some(candidate)
    })();
    LAST.with(|s| s.borrow_mut().ms += now() - start);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> P {
        P { x, y }
    }
    #[test]
    fn integral_is_stable_outside_pixel_and_across_clamp_knots() {
        let a: f64 = 0.7123456;
        let b = a + 2e-12;
        let exact = (a + b) * 0.5;
        let old = (b * b * 0.5 - a * a * 0.5) / (b - a);
        assert!((old - exact).abs() > 1e-8);
        assert!((clamped_integral(a, b, 1.) - exact).abs() < 1e-15);
        println!(
            "NEAR_FLAT_AREA old_error={} stable_error={}",
            (old - exact).abs(),
            (clamped_integral(a, b, 1.) - exact).abs()
        );
        assert_eq!(clamped_integral(1e10, 1e10 + 0.001, 0.8), 0.8);
        assert_eq!(clamped_integral(-1e10, -1e10 + 0.001, 0.8), 0.);
        assert!((clamped_integral(-1., 2., 1.) - 0.5).abs() < 1e-12);
        assert!((clamped_integral(2., -1., 1.) - 0.5).abs() < 1e-12);
    }
    #[test]
    fn analytic_area_moves_continuously_and_respects_winding() {
        let ss = [Sample {
            trusted: false,
            x: 0,
            y: 0,
            coverage: 0.,
        }];
        for x in [0.21, 0.22, 0.23, 0.2499, 0.2501] {
            let ps = vec![p(-1., -1.), p(x, -1.), p(x, 2.), p(-1., 2.), p(-1., -1.)];
            let a = coverages(&ps, &ss).unwrap()[0];
            assert!((a - x).abs() < 1e-10);
            let rev: Vec<_> = ps.into_iter().rev().collect();
            assert!((coverages(&rev, &ss).unwrap()[0] - a).abs() < 1e-10);
        }
    }
    #[test]
    fn area_handles_diagonal_concavity_and_degeneracy() {
        let ss = [Sample {
            trusted: false,
            x: 0,
            y: 0,
            coverage: 0.,
        }];
        let triangle = vec![p(0., 0.), p(1., 0.), p(0., 1.), p(0., 0.)];
        assert!((coverages(&triangle, &ss).unwrap()[0] - 0.5).abs() < 1e-10);
        let l = vec![
            p(0., 0.),
            p(1., 0.),
            p(1., 0.5),
            p(0.5, 0.5),
            p(0.5, 1.),
            p(0., 1.),
            p(0., 0.),
        ];
        assert!((coverages(&l, &ss).unwrap()[0] - 0.75).abs() < 1e-10);
        assert!(coverages(&[], &ss).is_none());
        assert!(coverages(&vec![p(f64::NAN, 0.); 4], &ss).is_none());
    }
    #[test]
    fn coverage_converges_on_curves_against_independent_dense_occupancy() {
        let c = G::Beziers(vec![
            [p(0., 0.), p(1., 0.), p(1., 1.), p(0., 1.)],
            [p(0., 1.), p(0., 1.), p(0., 0.), p(0., 0.)],
        ]);
        let s = [Sample {
            trusted: false,
            x: 0,
            y: 0,
            coverage: 0.,
        }];
        let values: Vec<_> = [0.04, 0.01, 0.002, 0.0001]
            .into_iter()
            .map(|t| coverages(&flatten(&c, t).unwrap(), &s).unwrap()[0])
            .collect();
        // Integral x dy for this known cubic is exactly 3/5 of the unit square.
        assert!((values[3] - 0.6).abs() < 0.0002);
        assert!((values[2] - 0.6).abs() < (values[0] - 0.6).abs());
        println!("COVERAGE_CONVERGENCE {:?} exact=0.6", values);
        let mut grid = Vec::new();
        for n in [4, 8, 16, 256] {
            let mut hits = 0.;
            for y in 0..n {
                let py = (y as f64 + 0.5) / n as f64;
                let (mut lo, mut hi) = (0., 1.);
                for _ in 0..40 {
                    let t = (lo + hi) * 0.5;
                    if 3. * t * t - 2. * t * t * t < py {
                        lo = t
                    } else {
                        hi = t
                    }
                }
                let t = (lo + hi) * 0.5;
                let x = 3. * t * (1. - t);
                for i in 0..n {
                    if (i as f64 + 0.5) / (n as f64) < x {
                        hits += 1.;
                    }
                }
            }
            grid.push(hits / (n * n) as f64);
        }
        println!(
            "COVERAGE_JSON {{\"polygon\":{:?},\"occupancy\":{:?},\"exact\":0.6}}",
            values, grid
        );
    }
}
#[cfg(test)]
mod safety_tests {
    use super::*;
    fn rect(x: f64) -> G {
        G::Polyline(vec![
            P { x, y: 10. },
            P { x: x + 20., y: 10. },
            P { x: x + 20., y: 30. },
            P { x, y: 30. },
            P { x, y: 10. },
        ])
    }
    #[test]
    fn source_stage_can_move_beyond_reducer_but_has_its_own_bound() {
        reset(true);
        assert!(displacement_bound(&rect(10.), &rect(11.), 4.));
        assert!(!crate::reduce::bounded(&rect(10.), &rect(11.), 0.12));
        assert!(!displacement_bound(&rect(10.), &rect(30.), 4.));
    }
    #[test]
    fn final_line_corners_do_not_disappear_with_zero_length_handles() {
        let points = [
            P { x: 0., y: 0. },
            P { x: 50., y: 0. },
            P { x: 50., y: 50. },
            P { x: 0., y: 50. },
            P { x: 0., y: 0. },
        ];
        let g = G::Beziers(
            points
                .windows(2)
                .map(|w| [w[0], w[0], w[1], w[1]])
                .collect(),
        );
        assert_eq!(corners(&g).len(), 4);
    }
    #[test]
    fn ownership_mismatch_fails_closed() {
        reset(true);
        remember(
            rect(10.).into_closed_subpath(),
            rect(11.).into_closed_subpath(),
        );
        let mut doc = vtracer::ir::VectorDoc::new(100, 100);
        assert!(repair(&mut doc).is_err());
    }
    #[test]
    fn ambiguous_ownership_does_not_rewrite_unrelated_layers() {
        reset(true);
        let new = rect(10.).into_closed_subpath();
        remember(new.clone(), rect(11.).into_closed_subpath());
        let mut doc = vtracer::ir::VectorDoc::new(100, 100);
        for color in [0, 255] {
            let mut path = vtracer::ir::MultiPath::new();
            path.push(new.clone());
            doc.shapes.push(vtracer::ir::Shape {
                paint: vtracer::ir::Paint::Solid(vtracer::Color::new(color, 0, 0)),
                path,
            });
        }
        assert!(repair(&mut doc).is_err());
        assert!(doc.shapes.iter().all(|s| s.path.subpaths[0] == new));
    }
    #[test]
    fn rollback_preserves_nested_face_membership_without_boundary_crossings() {
        reset(true);
        let make = |x: f64, y: f64, w: f64, h: f64| {
            G::Polyline(vec![
                P { x, y },
                P { x: x + w, y },
                P { x: x + w, y: y + h },
                P { x, y: y + h },
                P { x, y },
            ])
            .into_closed_subpath()
        };
        let old = make(0., 0., 50., 50.);
        let new = make(0., 0., 30., 50.);
        let child = make(35., 20., 2., 2.);
        remember(new.clone(), old.clone());
        let mut doc = vtracer::ir::VectorDoc::new(100, 100);
        for p in [new, child] {
            let mut path = vtracer::ir::MultiPath::new();
            path.push(p);
            doc.shapes.push(vtracer::ir::Shape {
                paint: vtracer::ir::Paint::Solid(vtracer::Color::new(0, 0, 0)),
                path,
            });
        }
        repair(&mut doc).unwrap();
        assert_eq!(doc.shapes[0].path.subpaths[0], old);
    }
    #[test]
    fn optimizer_rejects_open_and_degenerate_inputs() {
        reset(true);
        let img = ColorImage {
            width: 2,
            height: 2,
            pixels: vec![255; 16],
        };
        let seg = Segment {
            points: vec![
                vtracer::PointI32 { x: 0, y: 0 },
                vtracer::PointI32 { x: 1, y: 1 },
            ],
            start: Some(0),
            end: Some(1),
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        };
        assert!(refine(&seg, &img, &rect(0.), &[]).is_none());
        assert_eq!(values()[0], 0.);
    }
}
#[cfg(test)]
mod target_tests {
    use super::*;
    #[test]
    fn source_targets_change_geometry_without_adding_anchors_and_reject_untrusted_data() {
        let p = |x, y| P { x, y };
        let k = 20. * 0.5522847498307936;
        let truth = G::Beziers(vec![
            [p(60., 40.), p(60., 40. + k), p(40. + k, 60.), p(40., 60.)],
            [p(40., 60.), p(40. - k, 60.), p(20., 40. + k), p(20., 40.)],
            [p(20., 40.), p(20., 40. - k), p(40. - k, 20.), p(40., 20.)],
            [p(40., 20.), p(40. + k, 20.), p(60., 40. - k), p(60., 40.)],
        ]);
        let mut ss = vec![];
        for y in 18..63 {
            for x in 18..63 {
                ss.push(Sample {
                    x,
                    y,
                    coverage: 0.,
                    trusted: true,
                });
            }
        }
        let coverage = coverages(&flatten(&truth, 0.001).unwrap(), &ss).unwrap();
        for (s, c) in ss.iter_mut().zip(coverage) {
            s.coverage = c;
        }
        let mut points = vec![];
        for i in 0..=256 {
            let t = i as f64 / 256. * 2. * std::f64::consts::PI;
            let q = vtracer::PointI32 {
                x: (40. + 20. * t.cos()).round() as i32,
                y: (40. + 20. * t.sin()).round() as i32,
            };
            if points.last() != Some(&q) {
                points.push(q);
            }
        }
        let seg = Segment {
            points,
            start: None,
            end: None,
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        };
        let mut img = ColorImage {
            width: 80,
            height: 80,
            pixels: vec![255; 80 * 80 * 4],
        };
        for s in &ss {
            let i = (s.y as usize * 80 + s.x as usize) * 4;
            for (k, c) in [36., 90., 183.].into_iter().enumerate() {
                img.pixels[i + k] = (255. + s.coverage * (c - 255.)).round() as u8;
            }
        }
        let mut old = truth.clone();
        let G::Beziers(ref mut cs) = old else {
            unreachable!()
        };
        for (i, j) in [(1, 0), (1, 1), (0, 2), (0, 3)] {
            cs[i][j].y += 0.4;
        }
        let before = loss(&old, &ss, 0.001);
        let candidate = crate::recovery::test_refine(&seg, &img, old.clone(), &ss);
        let after = loss(&candidate, &ss, 0.001);
        assert!(
            after < before * 0.8,
            "source target geometry must actually improve: {before} -> {after}"
        );
        let G::Beziers(cs) = &candidate else {
            unreachable!()
        };
        assert_eq!(cs.len(), 4);
        for i in 0..4 {
            assert!(distance(cs[i][3], cs[(i + 1) % 4][0]) < 1e-12);
        }
        assert!(crate::planar::valid_model(&seg, &candidate, 80, 80));
        let mut junction = seg.clone();
        junction.start = Some(0);
        junction.end = Some(1);
        assert_eq!(
            crate::recovery::test_refine(&junction, &img, old.clone(), &ss).into_closed_subpath(),
            old.clone().into_closed_subpath()
        );
        for s in &mut ss {
            s.trusted = false;
        }
        assert_eq!(
            crate::recovery::test_refine(&seg, &img, old.clone(), &ss).into_closed_subpath(),
            old.into_closed_subpath()
        );
    }
}
