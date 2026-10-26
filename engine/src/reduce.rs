//! Bounded reuse of VTracer/flo_curves fitting, independently checked against
//! the existing vector geometry. Segmentation and paint ownership never change.
use flo_curves::{
    Coord2,
    bezier::{Curve, fit_curve_cubic},
};
use std::{cell::RefCell, collections::HashMap};
use vtracer::{
    PointF64 as P,
    ir::{PathCmd, SubPath, VectorDoc},
    mosaic::FittedGeom as G,
};
#[derive(Default, Clone)]
pub struct Stats {
    pub attempts: u32,
    pub accepted: u32,
    pub rejected: u32,
    pub before: u32,
    pub after: u32,
    pub samples: u32,
    pub exhausted: bool,
    pub ms: f64,
    pub reason: u32,
}
thread_local! {static LAST:RefCell<Stats>=RefCell::new(Stats::default());}
pub fn reset() {
    LAST.with(|s| *s.borrow_mut() = Stats::default());
}
pub fn values() -> Vec<f64> {
    LAST.with(|s| {
        let s = s.borrow();
        vec![
            s.attempts as f64,
            s.accepted as f64,
            s.rejected as f64,
            s.before as f64,
            s.after as f64,
            s.samples as f64,
            s.exhausted as u8 as f64,
            s.ms,
            s.reason as f64,
        ]
    })
}
#[cfg(target_arch = "wasm32")]
fn clock() -> f64 {
    crate::now()
}
#[cfg(not(target_arch = "wasm32"))]
fn clock() -> f64 {
    0.
}
fn dist(a: P, b: P) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn mix(a: P, b: P, t: f64) -> P {
    P {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}
fn unit(a: P, b: P) -> Option<Coord2> {
    let d = dist(a, b);
    (d > 1e-8).then(|| Coord2((b.x - a.x) / d, (b.y - a.y) / d))
}
fn tangents(c: &[P; 4]) -> Option<(Coord2, Coord2)> {
    Some((
        unit(c[0], c[1])
            .or_else(|| unit(c[0], c[2]))
            .or_else(|| unit(c[0], c[3]))?,
        unit(c[2], c[3])
            .or_else(|| unit(c[1], c[3]))
            .or_else(|| unit(c[0], c[3]))?,
    ))
}
fn angle(a: &[P; 4], b: &[P; 4]) -> f64 {
    match (tangents(a), tangents(b)) {
        (Some((_, u)), Some((v, _))) => (u.0 * v.0 + u.1 * v.1).clamp(-1., 1.).acos(),
        _ => std::f64::consts::PI,
    }
}
fn line(c: &[P; 4]) -> bool {
    let d = dist(c[0], c[3]);
    if d < 1e-8 {
        return false;
    }
    let dx = c[3].x - c[0].x;
    let dy = c[3].y - c[0].y;
    let proj = |p: P| ((p.x - c[0].x) * dx + (p.y - c[0].y) * dy) / (d * d);
    let a = proj(c[1]);
    let b = proj(c[2]);
    [c[1], c[2]]
        .iter()
        .all(|p| ((p.x - c[0].x) * dy - (p.y - c[0].y) * dx).abs() / d < 1e-9)
        && a >= 0.
        && b >= a
        && b <= 1.
}
fn finite(ps: &[P]) -> bool {
    ps.iter().all(|p| {
        p.x.is_finite() && p.y.is_finite() && p.x.abs() <= 2_000_000. && p.y.abs() <= 2_000_000.
    })
}
fn segment_distance(p: P, a: P, b: P) -> f64 {
    let d = dist(a, b).powi(2);
    if d < 1e-18 {
        return dist(p, a);
    }
    let t = (((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d).clamp(0., 1.);
    dist(p, mix(a, b, t))
}
/// Independent two-sided Lipschitz distance bound. Flatness <= 0.002 px for each
/// cubic; sample spacing <= tolerance/2. No Bézier-parameter correspondence.
pub fn bounded(a: &G, b: &G, tol: f64) -> bool {
    let a = crate::planar::flatten(a);
    let b = crate::planar::flatten(b);
    if a.len() < 2
        || b.len() < 2
        || a.len() > 32768
        || b.len() > 32768
        || !finite(&a)
        || !finite(&b)
        || !tol.is_finite()
        || tol < 0.02
    {
        return false;
    }
    let cell = 0.25;
    let mut checks = 0usize;
    let mut count = 0u32;
    let valid = (|| {
        for (src, dst) in [(&a, &b), (&b, &a)] {
            let mut grid: HashMap<(i32, i32), Vec<(P, P)>> = HashMap::new();
            let mut entries = 0usize;
            for w in dst.windows(2) {
                // Subdivide long diagonal chords before indexing: their bounding box
                // would otherwise allocate quadratically many cells.
                let n = ((w[1].x - w[0].x).abs().max((w[1].y - w[0].y).abs()) / cell)
                    .ceil()
                    .max(1.) as usize;
                if n > 100000 {
                    return false;
                }
                for i in 0..n {
                    let a = mix(w[0], w[1], i as f64 / n as f64);
                    let b = mix(w[0], w[1], (i + 1) as f64 / n as f64);
                    for y in
                        (a.y.min(b.y) / cell).floor() as i32..=(a.y.max(b.y) / cell).floor() as i32
                    {
                        for x in (a.x.min(b.x) / cell).floor() as i32
                            ..=(a.x.max(b.x) / cell).floor() as i32
                        {
                            entries += 1;
                            if entries > 200000 {
                                return false;
                            }
                            grid.entry((x, y)).or_default().push((a, b));
                        }
                    }
                }
            }
            for w in src.windows(2) {
                let n = (dist(w[0], w[1]) / (tol * 0.5)).ceil().max(1.) as usize;
                if n > 200000 {
                    return false;
                }
                for i in 0..=n {
                    count += 1;
                    if count > 200000 {
                        LAST.with(|s| {
                            let mut s = s.borrow_mut();
                            s.exhausted = true;
                            s.reason = 1;
                        });
                        return false;
                    }
                    let q = mix(w[0], w[1], i as f64 / n as f64);
                    let key = ((q.x / cell).floor() as i32, (q.y / cell).floor() as i32);
                    let mut best = f64::INFINITY;
                    for y in -1..=1 {
                        for x in -1..=1 {
                            if let Some(ls) = grid.get(&(key.0 + x, key.1 + y)) {
                                for &(a, b) in ls {
                                    checks += 1;
                                    if checks > 2_000_000 {
                                        LAST.with(|s| {
                                            let mut s = s.borrow_mut();
                                            s.exhausted = true;
                                            s.reason = 2;
                                        });
                                        return false;
                                    }
                                    best = best.min(segment_distance(q, a, b));
                                }
                            }
                        }
                    }
                    // Every unsampled source point is <= tol/4 from a sample. Two 0.002px
                    // flattening errors leave this explicit budget for distance measurements.
                    if best > tol * 0.75 - 0.004 {
                        return false;
                    }
                }
            }
        }
        true
    })();
    LAST.with(|s| {
        let mut s = s.borrow_mut();
        s.samples = s.samples.saturating_add(count);
        if s.samples > 500000 {
            s.exhausted = true;
        }
    });
    valid
}
fn count(g: &G) -> usize {
    match g {
        G::Polyline(p) => p.len(),
        G::Beziers(c) => c.len(),
    }
}
fn tolerance(g: &G) -> f64 {
    let ps = crate::planar::flatten(g);
    if ps.len() < 2 {
        return 0.025;
    }
    let mut lo = P {
        x: f64::INFINITY,
        y: f64::INFINITY,
    };
    let mut hi = P {
        x: f64::NEG_INFINITY,
        y: f64::NEG_INFINITY,
    };
    for p in ps {
        lo.x = lo.x.min(p.x);
        lo.y = lo.y.min(p.y);
        hi.x = hi.x.max(p.x);
        hi.y = hi.y.max(p.y);
    }
    let side = (hi.x - lo.x).max(hi.y - lo.y);
    if side <= 24. {
        0.025
    } else if side <= 256. {
        0.06
    } else {
        0.12
    }
}
fn sample(ps: &[P]) -> Option<Vec<Coord2>> {
    if ps.len() < 2 {
        return None;
    }
    let mut lengths = vec![0.];
    for w in ps.windows(2) {
        lengths.push(lengths.last()? + dist(w[0], w[1]));
    }
    let total = *lengths.last()?;
    if total < 1e-6 || !total.is_finite() {
        return None;
    }
    let n = (total / 0.6).ceil().clamp(8., 191.) as usize;
    let mut out = Vec::new();
    let mut j = 0;
    for i in 0..=n {
        let s = total * i as f64 / n as f64;
        while j + 2 < ps.len() && lengths[j + 1] < s {
            j += 1;
        }
        let d = lengths[j + 1] - lengths[j];
        let p = mix(
            ps[j],
            ps[j + 1],
            if d > 1e-12 { (s - lengths[j]) / d } else { 0. },
        );
        out.push(Coord2(p.x, p.y));
    }
    Some(out)
}
struct Support {
    points: Vec<P>,
    lengths: Vec<f64>,
    offsets: Vec<f64>,
    closed: bool,
}
impl Support {
    fn new(cs: &[[P; 4]], closed: bool) -> Option<Self> {
        let mut points = vec![cs[0][0]];
        let mut lengths = vec![0.];
        let mut offsets = vec![0.];
        for c in cs {
            let flat = crate::planar::flatten(&G::Beziers(vec![*c]));
            if flat.len() > 32768 || !finite(&flat) {
                return None;
            }
            for &p in flat.iter().skip(1) {
                lengths.push(lengths.last()? + dist(*points.last()?, p));
                points.push(p);
            }
            offsets.push(*lengths.last()?);
            if points.len() > 32768 {
                return None;
            }
        }
        Some(Self {
            points,
            lengths,
            offsets,
            closed,
        })
    }
    fn at(&self, s: f64) -> P {
        let total = *self.lengths.last().unwrap();
        let s = if self.closed {
            s.rem_euclid(total.max(1e-8))
        } else {
            s.clamp(0., total)
        };
        let j = self
            .lengths
            .partition_point(|v| *v <= s)
            .saturating_sub(1)
            .min(self.points.len() - 2);
        let d = self.lengths[j + 1] - self.lengths[j];
        mix(
            self.points[j],
            self.points[j + 1],
            if d > 1e-12 {
                (s - self.lengths[j]) / d
            } else {
                0.
            },
        )
    }
    fn corner(&self, i: usize) -> bool {
        let s = self.offsets[i];
        let total = *self.lengths.last().unwrap();
        let mut min = f64::INFINITY;
        let mut max: f64 = 0.;
        for k in [1f64, 2., 4.] {
            let k = k.min(total / 8.);
            if let (Some(a), Some(b)) = (
                unit(self.at(s - k), self.at(s)),
                unit(self.at(s), self.at(s + k)),
            ) {
                let angle = (a.0 * b.0 + a.1 * b.1).clamp(-1., 1.).acos();
                min = min.min(angle);
                max = max.max(angle);
            }
        }
        min > 0.5 && min / max.max(1e-8) > 0.6
    }
    fn tangent(&self, i: usize, before: bool) -> Option<Coord2> {
        let s = self.offsets[i];
        let length = if before { s } else { self.lengths.last()? - s };
        let delta = 1f64.min(length.max(0.1));
        if before {
            unit(
                self.at(s - delta),
                self.points
                    .last()
                    .copied()
                    .filter(|_| i + 1 == self.offsets.len())
                    .unwrap_or_else(|| self.at(s)),
            )
        } else {
            unit(self.at(s), self.at(s + delta))
        }
    }
}
/// Protected runs are fitted once using the existing Schneider implementation.
/// At most 193 upstream / 192 resampled fit points bound recursive work;
/// the library uses four Newton iterations and splits on its largest residual.
pub fn propose(g: &G, closed: bool) -> Option<G> {
    let G::Beziers(cs) = g else {
        return None;
    };
    if cs.len() <= 4
        || cs.len() > 4096
        || cs.windows(2).any(|w| dist(w[0][3], w[1][0]) > 1e-8)
        || cs.iter().any(|c| !finite(c) || tangents(c).is_none())
    {
        return None;
    }
    let permitted = LAST.with(|s| {
        let mut s = s.borrow_mut();
        if s.attempts >= 64 || s.exhausted {
            false
        } else {
            s.attempts += 1;
            true
        }
    });
    if !permitted {
        return None;
    }
    let tol = tolerance(g);
    let evidence = crate::corners::evidence();
    let mut protected = Vec::new();
    for r in evidence.chunks_exact(7) {
        if r[6] > 0. && r[3] >= 0.5 {
            protected.push(P { x: r[4], y: r[5] });
        }
    }
    let support = Support::new(cs, closed)?;
    let mut cuts = vec![0];
    for i in 1..cs.len() {
        if support.corner(i)
            || (line(&cs[i - 1]) && dist(cs[i - 1][0], cs[i - 1][3]) >= 6.)
                != (line(&cs[i]) && dist(cs[i][0], cs[i][3]) >= 6.)
            || protected.iter().any(|p| dist(*p, cs[i][0]) < 0.02)
        {
            cuts.push(i);
        }
    }
    if closed && cuts.len() == 1 {
        cuts.push(cs.len() / 2);
    }
    cuts.push(cs.len());
    let mut out = Vec::new();
    let mut exact = true;
    for w in cuts.windows(2) {
        let run = &cs[w[0]..w[1]];
        if run.len() < 2 {
            out.extend_from_slice(run);
            continue;
        }
        if run.iter().all(line)
            && run.windows(2).all(|w| angle(&w[0], &w[1]) < 1e-8)
            && run
                .iter()
                .flatten()
                .all(|p| segment_distance(*p, run[0][0], run.last().unwrap()[3]) < 1e-9)
        {
            let a = run[0][0];
            let b = run.last().unwrap()[3];
            out.push([a, a, b, b]);
            continue;
        }
        // Use upstream SimplifyCurves when its sample allocation is already bounded.
        let length: f64 = run
            .iter()
            .map(|c| dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]))
            .sum();
        let fitted = if length / 0.25 + run.len() as f64 <= 192. {
            use vtracer::simplify::CurvePass;
            match (vtracer::simplify::SimplifyCurves {
                tolerance: tol * 0.65 - 0.004,
                corner_threshold: std::f64::consts::PI,
            })
            .open(G::Beziers(run.to_vec()))
            {
                G::Beziers(c) => c,
                _ => return None,
            }
        } else {
            let ps = crate::planar::flatten(&G::Beziers(run.to_vec()));
            if !finite(&ps) {
                return None;
            }
            let data = sample(&ps)?;
            let start = support.tangent(w[0], false)?;
            let end = support.tangent(w[1], true)?;
            let c: Vec<Curve<Coord2>> =
                fit_curve_cubic(&data, &start, &Coord2(-end.0, -end.1), tol * 0.65 - 0.004);
            c.into_iter()
                .map(|c| {
                    let p = |q: Coord2| P { x: q.0, y: q.1 };
                    [
                        p(c.start_point),
                        p(c.control_points.0),
                        p(c.control_points.1),
                        p(c.end_point),
                    ]
                })
                .collect()
        };
        if fitted.len() < run.len() && !fitted.is_empty() {
            exact = false;
            out.extend(fitted)
        } else {
            out.extend_from_slice(run)
        }
    }
    if out.len() >= cs.len() {
        return None;
    }
    // Locate constraints before rounding; rounding can move an interior corner
    // farther than an equality epsilon. Restore by identity, never by proximity.
    let mut pins = vec![
        (0, 0, cs[0][0]),
        (out.len() - 1, 3, cs.last()?.get(3).copied()?),
    ];
    for &cut in &cuts[1..cuts.len() - 1] {
        let fixed = cs[cut][0];
        for (i, c) in out.iter().enumerate() {
            for j in [0, 3] {
                if dist(c[j], fixed) < 1e-8 {
                    pins.push((i, j, fixed));
                }
            }
        }
    }
    let mut candidate = G::Beziers(out);
    if !exact {
        round(&mut candidate);
    }
    if let G::Beziers(out) = &mut candidate {
        for (i, j, fixed) in pins {
            out[i][j] = fixed;
        }
    }
    if exact || bounded(g, &candidate, tol) {
        Some(candidate)
    } else {
        LAST.with(|s| s.borrow_mut().rejected += 1);
        None
    }
}
fn round(g: &mut G) {
    let p = |p: &mut P| {
        p.x = (p.x * 1e3).round() / 1e3;
        p.y = (p.y * 1e3).round() / 1e3;
    };
    match g {
        G::Polyline(ps) => ps.iter_mut().for_each(p),
        G::Beziers(cs) => cs.iter_mut().for_each(|c| c.iter_mut().for_each(p)),
    }
}
pub fn accepted(old: &G, new: &G) {
    LAST.with(|s| {
        let mut s = s.borrow_mut();
        s.accepted += 1;
        s.before += count(old) as u32;
        s.after += count(new) as u32;
    })
}
fn area(ps: &[P]) -> f64 {
    ps.windows(2)
        .map(|w| w[0].x * w[1].y - w[1].x * w[0].y)
        .sum()
}
pub(crate) fn inside(ps: &[P], p: P) -> bool {
    ps.windows(2)
        .filter(|w| {
            (w[0].y > p.y) != (w[1].y > p.y)
                && p.x < (w[1].x - w[0].x) * (p.y - w[0].y) / (w[1].y - w[0].y) + w[0].x
        })
        .count()
        % 2
        == 1
}
fn geom(path: &SubPath) -> Option<G> {
    let mut cs = Vec::new();
    let mut current = path.start()?;
    let start = current;
    for cmd in &path.commands {
        match *cmd {
            PathCmd::MoveTo(_) => {}
            PathCmd::LineTo(p) => {
                cs.push([
                    current,
                    mix(current, p, 1. / 3.),
                    mix(current, p, 2. / 3.),
                    p,
                ]);
                current = p;
            }
            PathCmd::CubicTo(a, b, p) => {
                cs.push([current, a, b, p]);
                current = p;
            }
            PathCmd::Close => {
                if dist(current, start) > 1e-8 {
                    cs.push([
                        current,
                        mix(current, start, 1. / 3.),
                        mix(current, start, 2. / 3.),
                        start,
                    ]);
                }
            }
        }
    }
    (!cs.is_empty()).then_some(G::Beziers(cs))
}
/// Stacked shapes only. Shared edges are handled in their upstream cache instead.
/// Establish the reduced knot topology. A source-constrained caller may refine
/// these final knots afterwards; only exact `serialize_lines` may follow it.
pub fn document(doc: &mut VectorDoc) {
    runtime_scope!(2);
    let started = clock();
    if doc
        .shapes
        .iter()
        .flat_map(|s| &s.path.subpaths)
        .map(|p| p.commands.len())
        .sum::<usize>()
        > 65536
    {
        return;
    }
    let mut paths = Vec::new();
    for (i, s) in doc.shapes.iter().enumerate() {
        for (j, p) in s.path.subpaths.iter().enumerate() {
            if let Some(g) = geom(p) {
                paths.push((i, j, g));
            }
        }
    }
    if paths.len() > 128 {
        return;
    }
    let mut current: Vec<G> = paths.iter().map(|p| p.2.clone()).collect();
    for i in 0..paths.len() {
        let old = current[i].clone();
        let Some(new) = propose(&old, true) else {
            continue;
        };
        let a = crate::planar::flatten(&old);
        let b = crate::planar::flatten(&new);
        if !finite(&b)
            || b.iter()
                .any(|p| p.x < 0. || p.y < 0. || p.x > doc.width as f64 || p.y > doc.height as f64)
            || area(&a) * area(&b) <= 0.
        {
            continue;
        }
        let others: Vec<_> = current
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, g)| g.clone())
            .collect();
        if !crate::planar::replacement_clear(&new, &others)
            || others.iter().any(|g| {
                let p = crate::planar::flatten(g);
                p.first().is_some_and(|p| inside(&a, *p) != inside(&b, *p))
            })
        {
            LAST.with(|s| s.borrow_mut().rejected += 1);
            continue;
        }
        doc.shapes[paths[i].0].path.subpaths[paths[i].1] = new.clone().into_closed_subpath();
        accepted(&old, &new);
        current[i] = new;
    }
    LAST.with(|s| s.borrow_mut().ms += clock() - started);
}
/// Exact-locus canonicalization only, symmetric under reversal. No refitting or
/// precision loss is permitted here, including on composed shared faces.
pub fn serialize_lines(doc: &mut VectorDoc) {
    for s in &mut doc.shapes {
        for p in &mut s.path.subpaths {
            let mut last = p.start().unwrap_or(P { x: 0., y: 0. });
            for cmd in &mut p.commands {
                match *cmd {
                    PathCmd::MoveTo(q) | PathCmd::LineTo(q) => last = q,
                    PathCmd::CubicTo(a, b, q) => {
                        if line(&[last, a, b, q]) {
                            *cmd = PathCmd::LineTo(q);
                        }
                        last = q;
                    }
                    PathCmd::Close => {}
                }
            }
        }
    }
}
pub fn timed<T>(f: impl FnOnce() -> T) -> T {
    let t = clock();
    let result = f();
    LAST.with(|s| s.borrow_mut().ms += clock() - t);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> P {
        P { x, y }
    }
    fn straight(a: P, b: P) -> [P; 4] {
        [a, mix(a, b, 1. / 3.), mix(a, b, 2. / 3.), b]
    }
    fn arc(r: f64, a: f64, b: f64) -> [P; 4] {
        let k = 4. / 3. * ((b - a) / 4.).tan();
        let u = p(r * a.cos() + 120., r * a.sin() + 120.);
        let v = p(r * b.cos() + 120., r * b.sin() + 120.);
        [
            u,
            p(u.x - k * r * a.sin(), u.y + k * r * a.cos()),
            p(v.x + k * r * b.sin(), v.y - k * r * b.cos()),
            v,
        ]
    }
    #[test]
    fn dense_smooth_arc_reuses_existing_fitter_and_pins_endpoints() {
        reset();
        let cs: Vec<_> = (0..32)
            .map(|i| arc(90., i as f64 * 0.04, (i + 1) as f64 * 0.04))
            .collect();
        let old = G::Beziers(cs.clone());
        let new = propose(&old, false).expect("smooth arc should compact");
        assert!(count(&new) < cs.len() / 2);
        let G::Beziers(out) = &new else { panic!() };
        assert!(dist(out[0][0], cs[0][0]) < 1e-8);
        assert!(dist(out.last().unwrap()[3], cs.last().unwrap()[3]) < 1e-8);
        assert!(bounded(&old, &new, tolerance(&old)));
    }
    #[test]
    fn corners_and_shared_junction_endpoints_survive() {
        reset();
        let mut cs = Vec::new();
        for i in 0..10 {
            cs.push(straight(p(i as f64 * 5., 0.), p((i + 1) as f64 * 5., 0.)));
        }
        for i in 0..10 {
            cs.push(straight(p(50., i as f64 * 5.), p(50., (i + 1) as f64 * 5.)));
        }
        let g = propose(&G::Beziers(cs), false).unwrap();
        let G::Beziers(c) = g else { panic!() };
        assert_eq!(c.len(), 2);
        assert_eq!(c[0][0], p(0., 0.));
        assert_eq!(c[0][3], p(50., 0.));
        assert_eq!(c[1][0], p(50., 0.));
        assert_eq!(c[1][3], p(50., 50.));
    }
    #[test]
    fn off_grid_interior_corner_survives_actual_rounding() {
        reset();
        let mut cs: Vec<_> = (0..32)
            .map(|i| arc(90., i as f64 * 0.04, (i + 1) as f64 * 0.04))
            .collect();
        let fixed = cs.last().unwrap()[3];
        for i in 0..10 {
            cs.push(straight(
                p(fixed.x + i as f64 * 5., fixed.y),
                p(fixed.x + (i + 1) as f64 * 5., fixed.y),
            ));
        }
        let old = G::Beziers(cs);
        let G::Beziers(out) = propose(&old, false).unwrap() else {
            panic!()
        };
        assert!(out.windows(2).any(|w| w[0][3] == fixed && w[1][0] == fixed));
    }
    #[test]
    fn diagonal_validation_has_linear_index_allocation() {
        reset();
        let g = G::Polyline(vec![p(0., 0.), p(1024., 1024.)]);
        assert!(bounded(&g, &g, 0.12));
        let huge = G::Polyline(vec![p(0., 0.), p(2_000_000., 2_000_000.)]);
        assert!(!bounded(&huge, &huge, 0.12));
    }
    #[test]
    fn reverse_distance_rejects_an_unsupported_loop() {
        reset();
        let a = G::Polyline(vec![p(0., 0.), p(100., 0.)]);
        let b = G::Beziers(vec![[p(0., 0.), p(100., 120.), p(0., -120.), p(100., 0.)]]);
        assert!(!bounded(&a, &b, 0.06));
    }
    #[test]
    fn exact_line_serialization_keeps_anchors_and_rejects_overshooting_handles() {
        let mut doc = VectorDoc::new(100, 100);
        let mut path = SubPath::new();
        path.commands = vec![
            PathCmd::MoveTo(p(0., 0.)),
            PathCmd::CubicTo(p(10., 0.), p(20., 0.), p(30., 0.)),
            PathCmd::CubicTo(p(100., 0.), p(-100., 0.), p(30., 0.)),
            PathCmd::Close,
        ];
        let mut mp = vtracer::ir::MultiPath::new();
        mp.push(path);
        doc.shapes.push(vtracer::ir::Shape {
            paint: vtracer::ir::Paint::Solid(vtracer::Color::new(0, 0, 0)),
            path: mp,
        });
        serialize_lines(&mut doc);
        assert_eq!(
            doc.shapes[0].path.subpaths[0].commands[1],
            PathCmd::LineTo(p(30., 0.))
        );
        assert!(matches!(
            doc.shapes[0].path.subpaths[0].commands[2],
            PathCmd::CubicTo(..)
        ));
    }
    #[test]
    fn degenerate_nonfinite_extreme_and_tiny_contours_fail_closed() {
        reset();
        for g in [
            G::Polyline(vec![]),
            G::Beziers(vec![[p(0., 0.); 4]; 8]),
            G::Beziers(vec![[p(f64::NAN, 1.); 4]; 8]),
            G::Beziers(vec![[p(1e300, 1e300); 4]; 8]),
        ] {
            assert!(propose(&g, true).is_none());
        }
        assert!(!bounded(
            &G::Polyline(vec![p(0., 0.)]),
            &G::Polyline(vec![p(0., 0.)]),
            0.1
        ));
    }
}
