//! Research-only, output-consistent source geometry. No segmentation or tracing.
use crate::source_fit::Sample;
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};
use vtracer::{
    ColorImage, PointF64 as P,
    ir::{SubPath, VectorDoc},
    mosaic::{FittedGeom as G, Segment},
};
type C = [P; 4];
mod acute;
mod apex_trace;
mod continuity;
#[derive(Clone)]
struct Context {
    path: SubPath,
    seg: Segment,
    ss: Vec<Sample>,
    location: Option<(usize, usize)>,
    deferred: bool,
}
thread_local! {static CONTEXTS:RefCell<Vec<Context>>=const{RefCell::new(Vec::new())};static STATS:RefCell<[f64;35]>=const{RefCell::new([0.;35])};static INITIALIZATION:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub fn reset() {
    #[cfg(feature = "large_apex")]
    acute::large::reset();
    acute::reset();
    apex_trace::reset();
    continuity::reset();
    CONTEXTS.with(|c| c.borrow_mut().clear());
    STATS.with(|s| *s.borrow_mut() = [0.; 35]);
    INITIALIZATION.with(|s| s.borrow_mut().clear());
}
#[cfg(feature = "large_apex")]
pub fn large_evidence() -> Vec<f64> {
    acute::large::evidence()
}
pub fn acute_evidence() -> Vec<f64> {
    acute::evidence()
}
pub fn apex_evidence() -> Vec<f64> {
    apex_trace::values()
}
pub fn continuity_evidence() -> Vec<f64> {
    continuity::evidence()
}
pub fn initialization() -> Vec<f64> {
    INITIALIZATION.with(|s| s.borrow().clone())
}
pub fn observe_initialization(mean: f64, seg: &Segment, ss: &[Sample], knots: usize) {
    INITIALIZATION.with(|s| {
        let mut s = s.borrow_mut();
        if s.len() < 1536 {
            s.extend([
                mean,
                ss.len() as f64,
                ss.iter().filter(|s| s.trusted).count() as f64,
                seg.points.len() as f64,
                knots as f64,
                (mean < 0.008) as u8 as f64,
            ]);
        }
    });
}
pub fn values() -> Vec<f64> {
    STATS.with(|s| s.borrow().to_vec())
}
fn count(i: usize, n: f64) {
    STATS.with(|s| s.borrow_mut()[i] += n);
}
#[cfg(target_arch = "wasm32")]
fn now() -> f64 {
    crate::now()
}
#[cfg(not(target_arch = "wasm32"))]
fn now() -> f64 {
    0.
}
pub fn capture(g: &G, seg: &Segment, ss: &[Sample]) {
    capture_mode(g, seg, ss, false)
}
pub fn capture_deferred(g: &G, seg: &Segment, ss: &[Sample]) {
    capture_mode(g, seg, ss, true)
}
fn capture_mode(g: &G, seg: &Segment, ss: &[Sample], deferred: bool) {
    if !seg.is_ring()
        || seg.points.len() < 4
        || seg.points.len() > 8192
        || ss.len() > 8192
        || !ss.iter().any(|s| s.trusted)
    {
        return;
    }
    CONTEXTS.with(|c| {
        let mut c = c.borrow_mut();
        // A new deferred low-loss cap must never evict an established Stage
        // 1.6B initialization or consume its four-component research budget.
        if c.len() == 4 && !deferred {
            if let Some(i) = c.iter().rposition(|c| c.deferred) {
                c.remove(i);
            }
        }
        if c.len() < 4 {
            c.push(Context {
                path: g.clone().into_closed_subpath(),
                seg: seg.clone(),
                ss: ss.to_vec(),
                location: None,
                deferred,
            });
        }
    });
}
pub fn locate(doc: &VectorDoc, img: &ColorImage) {
    if CONTEXTS.with(|c| c.borrow().is_empty()) {
        return;
    }
    CONTEXTS.with(|c| {
        for ctx in c.borrow_mut().iter_mut() {
            let mut found = None;
            let mut matches = 0;
            for (i, s) in doc.shapes.iter().enumerate() {
                for (j, p) in s.path.subpaths.iter().enumerate() {
                    if *p == ctx.path {
                        found = Some((i, j));
                        matches += 1;
                    }
                }
            }
            // A deferred upstream spline may not yet have undergone the
            // compositor's quantization/cleanup. Compare that exact canonical
            // policy only when the raw identity failed; never use proximity or
            // choose one of multiple canonically identical owners.
            if matches == 0
                && ctx.deferred
                && doc.shapes.len() <= 64
                && doc
                    .shapes
                    .iter()
                    .flat_map(|s| &s.path.subpaths)
                    .map(|p| p.commands.len())
                    .sum::<usize>()
                    <= 65536
            {
                let canonical = |path: &SubPath| {
                    crate::source_fit::from_path(path)
                        .and_then(|g| crate::source_fit::quantized(g, img))
                        .map(|(_, p)| p)
                };
                if let Some(key) = canonical(&ctx.path) {
                    for (i, s) in doc.shapes.iter().enumerate() {
                        for (j, path) in s.path.subpaths.iter().enumerate() {
                            if canonical(path).is_some_and(|p| p == key) {
                                found = Some((i, j));
                                matches += 1;
                            }
                        }
                    }
                    if matches == 1 {
                        count(29, 1.);
                    }
                }
            }
            ctx.location = if matches == 1 { found } else { None };
        }
    });
}
fn p(x: f64, y: f64) -> P {
    P { x, y }
}
fn sub(a: P, b: P) -> P {
    p(a.x - b.x, a.y - b.y)
}
fn add(a: P, b: P) -> P {
    p(a.x + b.x, a.y + b.y)
}
fn mul(a: P, t: f64) -> P {
    p(a.x * t, a.y * t)
}
fn dot(a: P, b: P) -> f64 {
    a.x * b.x + a.y * b.y
}
fn norm(a: P) -> f64 {
    a.x.hypot(a.y)
}
fn dist(a: P, b: P) -> f64 {
    norm(sub(a, b))
}
fn unit(a: P) -> P {
    mul(a, 1. / norm(a).max(1e-12))
}
fn cross(a: P, b: P) -> f64 {
    a.x * b.y - a.y * b.x
}
fn eval(c: &C, t: f64) -> (P, P) {
    let u = 1. - t;
    let q = add(
        add(mul(c[0], u * u * u), mul(c[1], 3. * u * u * t)),
        add(mul(c[2], 3. * u * t * t), mul(c[3], t * t * t)),
    );
    let v = mul(
        add(
            add(
                mul(sub(c[1], c[0]), u * u),
                mul(sub(c[2], c[1]), 2. * u * t),
            ),
            mul(sub(c[3], c[2]), t * t),
        ),
        3.,
    );
    (q, v)
}
fn length(c: &C) -> f64 {
    let mut len = 0.;
    let mut a = c[0];
    for i in 1..=16 {
        let b = eval(c, i as f64 / 16.).0;
        len += dist(a, b);
        a = b;
    }
    len
}
fn area(cs: &[C]) -> f64 {
    cs.iter().map(|c| cross(c[0], c[3])).sum()
}
fn turn(cs: &[C], i: usize) -> f64 {
    let (_, u) = crate::inverse::endpoint_tangents(&cs[(i + cs.len() - 1) % cs.len()]);
    let (v, _) = crate::inverse::endpoint_tangents(&cs[i]);
    dot(unit(u), unit(v)).clamp(-1., 1.).acos()
}
fn corners(cs: &[C]) -> Vec<(usize, f64, f64)> {
    (0..cs.len())
        .filter_map(|i| {
            let t = turn(cs, i);
            (t > 0.61).then(|| {
                (
                    i,
                    t,
                    (1.25 / ((std::f64::consts::PI - t) * 0.5).sin().max(1e-6)).clamp(2.25, 6.),
                )
            })
        })
        .collect()
}
fn intersection(a: P, u: P, b: P, v: P) -> Option<P> {
    let d = cross(u, v);
    if d.abs() < 1e-5 {
        return None;
    }
    Some(add(a, mul(u, cross(sub(b, a), v) / d)))
}
fn move_node(cs: &mut [C], i: usize, q: P) {
    let prev = (i + cs.len() - 1) % cs.len();
    let delta = sub(q, cs[i][0]);
    cs[i][0] = q;
    cs[i][1] = add(cs[i][1], delta);
    cs[prev][3] = q;
    cs[prev][2] = add(cs[prev][2], delta);
}
fn round(cs: &mut [C]) {
    for q in cs.iter_mut().flatten() {
        q.x = (q.x * 1e4).round() / 1e4;
        q.y = (q.y * 1e4).round() / 1e4;
    }
}
fn curve_line(c: &C) -> bool {
    let v = sub(c[3], c[0]);
    let n = norm(v);
    n > 1e-6
        && [c[1], c[2]]
            .iter()
            .all(|q| cross(v, sub(*q, c[0])).abs() / n < 0.015)
}
fn axis(c: &C) -> Option<usize> {
    let v = sub(c[3], c[0]);
    let len = norm(v);
    if !curve_line(c) || len < 4. {
        return None;
    }
    if v.x.abs() < 0.02 * len {
        Some(0)
    } else if v.y.abs() < 0.02 * len {
        Some(1)
    } else {
        None
    }
}
#[derive(Clone)]
struct Matte {
    a: [f64; 3],
    b: [f64; 3],
    linear: bool,
    render_a: [f64; 3],
    render_b: [f64; 3],
}
impl Matte {
    fn from(img: &ColorImage, ss: &[Sample]) -> Option<Self> {
        let mut a = vec![];
        let mut b = vec![];
        let mut colors = vec![];
        for s in ss.iter().filter(|s| s.trusted) {
            if s.x < 0 || s.y < 0 || s.x >= img.width as i32 || s.y >= img.height as i32 {
                return None;
            }
            let i = (s.y as usize * img.width + s.x as usize) * 4;
            if img.pixels[i + 3] != 255 {
                return None;
            }
            let c = std::array::from_fn(|k| img.pixels[i + k] as f64 / 255.);
            if s.coverage > 0.999 {
                a.push(c);
            }
            if s.coverage < 0.001 {
                b.push(c);
            }
            colors.push(c);
        }
        if a.len() < 8 || b.len() < 8 {
            return None;
        }
        let med = |v: &[[f64; 3]]| {
            std::array::from_fn(|k| {
                let mut c: Vec<_> = v.iter().map(|c| c[k]).collect();
                c.sort_by(f64::total_cmp);
                c[c.len() / 2]
            })
        };
        let (a, b) = (med(&a), med(&b));
        let linear = crate::unmix::select(&colors, a, b)?;
        Some(Self {
            a,
            b,
            linear,
            render_a: a,
            render_b: b,
        })
    }
    fn sample(&self, img: &ColorImage, x: i32, y: i32) -> Option<Sample> {
        if x < 0 || y < 0 || x >= img.width as i32 || y >= img.height as i32 {
            return None;
        }
        let i = (y as usize * img.width + x as usize) * 4;
        if img.pixels[i + 3] != 255 {
            return None;
        }
        let c = std::array::from_fn(|k| img.pixels[i + k] as f64 / 255.);
        let (t, e) = crate::unmix::project(c, self.a, self.b, self.linear)?;
        if e > 3. / 255f64.powi(2) {
            return None;
        }
        Some(Sample {
            x,
            y,
            coverage: t,
            trusted: true,
        })
    }
    fn patch(&self, img: &ColorImage, q: P, r: i32) -> Vec<Sample> {
        let mut ss = vec![];
        for y in q.y.floor() as i32 - r..=q.y.floor() as i32 + r {
            for x in q.x.floor() as i32 - r..=q.x.floor() as i32 + r {
                if let Some(s) = self.sample(img, x, y) {
                    ss.push(s);
                }
            }
        }
        ss
    }
    /// Final solid SVG paints composite in encoded sRGB. Source gamma is used
    /// for unmixing coverage, independently of the export's paint quantization.
    fn color(&self, t: f64) -> [f64; 3] {
        std::array::from_fn(|k| self.render_b[k] + t * (self.render_a[k] - self.render_b[k]))
    }
    fn exported_colors(&mut self, doc: &VectorDoc, owner: usize, ss: &[Sample]) -> bool {
        if doc.shapes.len() > 64 {
            return false;
        }
        let a = doc.shapes[owner].paint.color();
        self.render_a = [a.r as f64 / 255., a.g as f64 / 255., a.b as f64 / 255.];
        let flat: Vec<_> = doc
            .shapes
            .iter()
            .map(|s| {
                s.path
                    .subpaths
                    .iter()
                    .filter_map(crate::source_fit::from_path)
                    .map(|g| crate::planar::flatten(&g))
                    .collect::<Vec<_>>()
            })
            .collect();
        let outside: Vec<_> = ss
            .iter()
            .filter(|s| s.trusted && s.coverage < 0.001)
            .collect();
        if outside.len() < 8 {
            return false;
        }
        let mut paints: HashMap<(u8, u8, u8), usize> = HashMap::new();
        let mut samples = 0;
        for s in outside.iter().step_by(outside.len().div_ceil(32).max(1)) {
            let q = p(s.x as f64 + 0.5, s.y as f64 + 0.5);
            let mut color = None;
            for (k, shape) in doc.shapes.iter().enumerate() {
                if k == owner {
                    continue;
                }
                let inside = flat[k]
                    .iter()
                    .filter(|p| crate::reduce::inside(p, q))
                    .count()
                    % 2
                    == 1;
                if inside {
                    let c = shape.paint.color();
                    color = Some((c.r, c.g, c.b));
                }
            }
            if let Some(c) = color {
                *paints.entry(c).or_default() += 1;
                samples += 1;
            }
        }
        let Some((b, n)) = paints.into_iter().max_by_key(|(_, n)| *n) else {
            return false;
        };
        if n * 5 < samples * 4 {
            return false;
        }
        self.render_b = [b.0 as f64 / 255., b.1 as f64 / 255., b.2 as f64 / 255.];
        self.a
            .iter()
            .zip(self.render_a)
            .all(|(a, b)| (a - b).abs() < 0.1)
            && self
                .b
                .iter()
                .zip(self.render_b)
                .all(|(a, b)| (a - b).abs() < 0.1)
    }
    fn score(&self, cs: &[C], ss: &[Sample], img: &ColorImage) -> (f64, f64) {
        runtime_scope!(18);
        runtime_count!(28, 1);
        if ss.is_empty() {
            return (f64::INFINITY, f64::INFINITY);
        }
        count(2, 1.);
        let Some(flat) = crate::inverse::flatten(&G::Beziers(cs.to_vec()), 0.001) else {
            return (f64::INFINITY, f64::INFINITY);
        };
        let Some(cov) = crate::inverse::coverages(&flat, ss) else {
            return (f64::INFINITY, f64::INFINITY);
        };
        let mut mse = 0.;
        let mut mae = 0.;
        for (s, t) in ss.iter().zip(cov) {
            mse += (t - s.coverage).powi(2);
            let c = self.color(t);
            let i = (s.y as usize * img.width + s.x as usize) * 4;
            for k in 0..3 {
                mae += (c[k] - img.pixels[i + k] as f64 / 255.).abs();
            }
        }
        (mse / ss.len() as f64, mae / ss.len() as f64)
    }
}
fn geometry_safe(cs: &[C], old: &[C], img: &ColorImage) -> bool {
    if cs.len() < 3
        || cs.len() > old.len()
        || cs.iter().flatten().any(|p| {
            !p.x.is_finite()
                || !p.y.is_finite()
                || p.x < 0.
                || p.y < 0.
                || p.x > img.width as f64
                || p.y > img.height as f64
        })
    {
        return false;
    }
    if cs
        .iter()
        .enumerate()
        .any(|(i, c)| dist(c[3], cs[(i + 1) % cs.len()][0]) > 1e-8)
        || area(cs) * area(old) <= 0.
    {
        return false;
    }
    true
}
fn source_safe(cs: &[C], old: &[C], img: &ColorImage) -> bool {
    runtime_scope!(11);
    geometry_safe(cs, old, img)
        && crate::inverse::displacement_bound(
            &G::Beziers(old.to_vec()),
            &G::Beziers(cs.to_vec()),
            3.5,
        )
}

pub fn document(doc: &mut VectorDoc, img: &ColorImage) {
    runtime_scope!(3);
    if doc.shapes.len() > 64
        || doc
            .shapes
            .iter()
            .flat_map(|s| &s.path.subpaths)
            .map(|p| p.commands.len())
            .sum::<usize>()
            > 65536
        || img.pixels.chunks_exact(4).any(|p| p[3] != 255)
    {
        return;
    }
    let started = now();
    let contexts = CONTEXTS.with(|c| c.borrow().clone());
    for ctx in contexts {
        if !ctx.seg.is_ring() {
            continue;
        }
        let Some((i, j)) = ctx.location else { continue };
        if ctx.deferred {
            count(19, 1.);
        }
        let Some(G::Beziers(old)) = crate::source_fit::from_path(&doc.shapes[i].path.subpaths[j])
        else {
            continue;
        };
        if old.len() < 5 || old.len() > 128 {
            continue;
        }
        let Some(mut matte) = Matte::from(img, &ctx.ss) else {
            continue;
        };
        if !matte.exported_colors(doc, i, &ctx.ss) {
            continue;
        }
        runtime_count!(21, 1);
        runtime_count!(23, ctx.ss.len());
        count(0, 1.);
        let mut candidate = old.clone();
        #[cfg(feature = "large_apex")]
        let mut extended = None;
        if ctx.deferred {
            let acute = acute::initialize(&mut candidate, img, &matte);
            let sharp = !acute && acute::refine_sharp(&mut candidate, img, &matte);
            let continuous = continuity::refine(&mut candidate, img, &matte);
            if !acute && !sharp && !continuous {
                #[cfg(not(feature = "large_apex"))]
                {
                    runtime_count!(22, 1);
                    continue;
                }
                #[cfg(feature = "large_apex")]
                {
                    extended = acute::large::refine(&old, img, &matte);
                    let Some(ref proof) = extended else {
                        continue;
                    };
                    candidate = proof.geometry().to_vec();
                }
            } else {
                let span_started = now();
                span_recover(&mut candidate, &ctx.ss, img, &matte);
                count(17, now() - span_started);
            }
        } else {
            recover(&mut candidate, &ctx.ss, img, &matte);
            continuity::refine(&mut candidate, img, &matte);
        }
        round(&mut candidate);
        #[cfg(feature = "runtime_profile")]
        let _validation_scope = crate::runtime_profile::Scope::new(19);
        let validation_started = now();
        let legacy_safe = source_safe(&candidate, &old, img);
        #[cfg(feature = "large_apex")]
        let certified_safe = extended
            .as_ref()
            .is_some_and(|proof| proof.validate(&candidate, &old, img));
        #[cfg(not(feature = "large_apex"))]
        let certified_safe = false;
        if !legacy_safe && !certified_safe {
            apex_trace::component(
                100.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                None,
            );
            runtime_count!(22, 1);
            count(10, 1.);
            continue;
        }
        if !self_clear(&candidate) {
            apex_trace::component(
                104.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                None,
            );
            runtime_count!(22, 1);
            count(10, 1.);
            continue;
        }
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
        if !crate::planar::replacement_clear(&G::Beziers(candidate.clone()), &others) {
            apex_trace::component(
                101.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                None,
            );
            runtime_count!(22, 1);
            count(10, 1.);
            continue;
        }
        let a = crate::planar::flatten(&G::Beziers(old.clone()));
        let b = crate::planar::flatten(&G::Beziers(candidate.clone()));
        if others.iter().any(|o| {
            crate::planar::flatten(o)
                .first()
                .is_some_and(|p| crate::reduce::inside(&a, *p) != crate::reduce::inside(&b, *p))
        }) {
            apex_trace::component(
                102.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                None,
            );
            runtime_count!(22, 1);
            count(10, 1.);
            continue;
        }
        let before = matte.score(&old, &ctx.ss, img);
        let after = matte.score(&candidate, &ctx.ss, img);
        count(8, before.0);
        count(9, after.0);
        if after.0 < before.0 && after.1 <= before.1 {
            apex_trace::component(
                110.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                Some((before, after)),
            );
            #[cfg(feature = "large_apex")]
            if extended.is_some() {
                acute::large::committed(
                    legacy_safe,
                    &candidate,
                    &old,
                    now() - validation_started,
                    before,
                    after,
                );
            }
            doc.shapes[i].path.subpaths[j] = G::Beziers(candidate).into_closed_subpath();
            count(1, 1.);
        } else {
            runtime_count!(22, 1);
            apex_trace::component(
                103.,
                legacy_safe,
                &old,
                &candidate,
                now() - validation_started,
                Some((before, after)),
            );
        }
    }
    count(11, now() - started);
}

fn recover(cs: &mut Vec<C>, ss: &[Sample], img: &ColorImage, matte: &Matte) {
    let corner_started = now();
    axis_recover(cs, img, matte);
    collapse_and_apex(cs, img, matte, true);
    count(18, now() - corner_started);
    let t = now();
    span_recover(cs, ss, img, matte);
    count(17, now() - t);
    let corner_started = now();
    collapse_and_apex(cs, img, matte, false);
    count(18, now() - corner_started);
}
fn axis_recover(cs: &mut Vec<C>, img: &ColorImage, matte: &Matte) {
    let mut i = 0;
    while i < cs.len() {
        let Some(ax) = axis(&cs[i]) else {
            i += 1;
            continue;
        };
        if length(&cs[i]) < 12. {
            i += 1;
            continue;
        }
        let n = cs.len();
        let v = unit(sub(cs[i][3], cs[i][0]));
        let sign = if area(cs) > 0. { 1. } else { -1. };
        let normal = p(sign * v.y, -sign * v.x);
        let direction = if ax == 0 {
            normal.x.signum()
        } else {
            normal.y.signum()
        };
        let mut band = vec![];
        let mut seen = HashSet::new();
        for t in [0.2, 0.4, 0.6, 0.8] {
            for s in matte.patch(img, eval(&cs[i], t).0, 2) {
                if seen.insert((s.x, s.y)) {
                    band.push(s);
                }
            }
        }
        let mut lo = f64::NEG_INFINITY;
        let mut hi = f64::INFINITY;
        let mut eq = vec![];
        for s in &band {
            let coord = if ax == 0 { s.x } else { s.y } as f64;
            if s.coverage > 0.001 && s.coverage < 0.999 {
                eq.push(
                    coord + 0.5 + crate::unmix::offset(s.coverage, 1., 0.).unwrap() * direction,
                );
            } else if (s.coverage >= 0.999) == (direction > 0.) {
                lo = lo.max(coord + 1.);
            } else {
                hi = hi.min(coord);
            }
        }
        let target = if eq.len() >= 4 {
            eq.sort_by(f64::total_cmp);
            eq[eq.len() / 2]
        } else if lo.is_finite() && hi.is_finite() && (hi - lo).abs() < 0.05 {
            (lo + hi) * 0.5
        } else {
            i += 1;
            continue;
        };
        let coord = |p: P| if ax == 0 { p.x } else { p.y };
        let current = (coord(cs[i][0]) + coord(cs[i][3])) * 0.5;
        if (target - current).abs() > 0.65 {
            i += 1;
            continue;
        }
        let prev = (i + n - 1) % n;
        let extend = length(&cs[prev]) < 8.
            && cs[prev].iter().all(|p| (coord(*p) - target).abs() < 0.35)
            && dot(unit(sub(cs[prev][3], cs[prev][0])), v) > 0.95;
        if (target - current).abs() < 0.05
            && (coord(cs[i][0]) - coord(cs[i][3])).abs() < 0.02
            && !extend
        {
            i += 1;
            continue;
        }
        let mut trial = cs.clone();
        let end = (i + 1) % n;
        for node in [if extend { prev } else { i }, end] {
            let mut q = trial[node][0];
            if ax == 0 {
                q.x = target
            } else {
                q.y = target
            }
            move_node(&mut trial, node, q);
        }
        if extend {
            for s in matte.patch(img, cs[prev][0], 3) {
                if seen.insert((s.x, s.y)) {
                    band.push(s);
                }
            }
            let a = trial[prev][0];
            let b = trial[i][3];
            trial[i] = [
                a,
                add(a, mul(sub(b, a), 1. / 3.)),
                add(a, mul(sub(b, a), 2. / 3.)),
                b,
            ];
            trial.remove(prev);
        }
        let before = matte.score(cs, &band, img);
        let after = matte.score(&trial, &band, img);
        if after.0 + 1e-10 < before.0 && after.1 <= before.1 {
            *cs = trial;
            count(3, 1.);
        }
        i += 1;
    }
}
fn collapse_and_apex(cs: &mut Vec<C>, img: &ColorImage, matte: &Matte, allow_collapse: bool) {
    // Tentative splice removal and apex refinement are accepted together against
    // the exact local 2-D region coverage, never a half-plane target in the wedge.
    let old = cs.clone();
    let mut trial = cs.clone();
    let mut changes = 0;
    while allow_collapse {
        let mut done = false;
        let n = trial.len();
        for i in 0..n {
            let prev = (i + n - 1) % n;
            let next = (i + 1) % n;
            let len = length(&trial[i]);
            let turn_sum = turn(&trial, i) + turn(&trial, next);
            if !((len < 2.25 || dist(trial[i][0], trial[i][3]) < 3.) && turn_sum > 0.61 && n > 4) {
                continue;
            }
            let (_, u) = crate::inverse::endpoint_tangents(&trial[prev]);
            let (v, _) = crate::inverse::endpoint_tangents(&trial[next]);
            let Some(q) = intersection(trial[i][0], unit(u), trial[i][3], unit(v)) else {
                continue;
            };
            if dist(q, trial[i][0]) > 3. || dist(q, trial[i][3]) > 5. {
                continue;
            }
            let p0 = trial[i][0];
            let p1 = trial[i][3];
            trial[prev][3] = q;
            trial[prev][2] = add(trial[prev][2], sub(q, p0));
            trial[next][0] = q;
            trial[next][1] = add(trial[next][1], sub(q, p1));
            trial.remove(i);
            changes += 1;
            done = true;
            break;
        }
        if !done || changes >= 8 {
            break;
        }
    }
    // Use baseline corner patches even if the tentative intersection shifts.
    let mut patches = vec![];
    let mut seen = HashSet::new();
    for (i, _, _) in corners(&old) {
        for s in matte.patch(img, old[i][0], 3) {
            if seen.insert((s.x, s.y)) {
                patches.push(s);
            }
        }
    }
    if patches.is_empty() {
        return;
    }
    let base = matte.score(&old, &patches, img);
    apex_search(&mut trial, &old, img, matte);
    let score = matte.score(&trial, &patches, img);
    if score.0 < base.0 && score.1 <= base.1 {
        *cs = trial;
        count(4, changes as f64);
    } else {
        let mut trial = old.clone();
        apex_search(&mut trial, &old, img, matte);
        let after = matte.score(&trial, &patches, img);
        if after.0 < base.0 && after.1 <= base.1 {
            *cs = trial;
        }
    }
}
fn arm_samples(cs: &[C], corner: usize, incoming: bool, start: f64, end: f64) -> Vec<(P, P)> {
    let mut points = vec![];
    let mut distance = 0.;
    let mut edge = if incoming {
        (corner + cs.len() - 1) % cs.len()
    } else {
        corner
    };
    for _ in 0..cs.len() {
        let c = cs[edge];
        let steps = (c.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>() * 2.)
            .ceil()
            .clamp(8., 2048.) as usize;
        let mut last = if incoming { c[3] } else { c[0] };
        for j in 1..=steps {
            let t = if incoming {
                1. - j as f64 / steps as f64
            } else {
                j as f64 / steps as f64
            };
            let (q, v) = eval(&c, t);
            distance += dist(last, q);
            last = q;
            if distance >= start && distance <= end {
                points.push((q, unit(v)));
            }
            if distance > end {
                return points;
            }
        }
        let next = if incoming {
            (edge + cs.len() - 1) % cs.len()
        } else {
            (edge + 1) % cs.len()
        };
        let junction = if incoming { edge } else { next };
        if turn(cs, junction) > 0.61 {
            break;
        }
        edge = next;
    }
    points
}
fn calibrate_arm(
    cs: &[C],
    i: usize,
    incoming: bool,
    matte: &Matte,
    img: &ColorImage,
) -> (P, P, f64) {
    let index = if incoming {
        (i + cs.len() - 1) % cs.len()
    } else {
        i
    };
    let (u, v) = crate::inverse::endpoint_tangents(&cs[index]);
    let direction = unit(if incoming { v } else { u });
    let origin = cs[i][0];
    if let Some(ax) = axis(&cs[index]) {
        let d = if ax == 0 {
            p(0., direction.y.signum())
        } else {
            p(direction.x.signum(), 0.)
        };
        return (origin, d, 1.);
    }
    let angle = turn(cs, i);
    let r = (1.25 / ((std::f64::consts::PI - angle) * 0.5).sin().max(1e-6)).clamp(2.25, 6.);
    let arm = arm_samples(cs, i, incoming, r + 1., 16.);
    let other = arm_samples(cs, i, !incoming, 0., 20.);
    let mut pixels = HashMap::new();
    for (q, _) in &arm {
        for s in matte.patch(img, *q, 1) {
            if s.coverage > 0.02 && s.coverage < 0.98 {
                let center = p(s.x as f64 + 0.5, s.y as f64 + 0.5);
                if other.iter().any(|(p, _)| dist(*p, center) < 2.25) {
                    continue;
                }
                pixels.insert((s.x, s.y), s);
            }
        }
    }
    if pixels.len() < 5 {
        return (origin, direction, 0.05);
    }
    let sign = if area(cs) > 0. { 1. } else { -1. };
    let mut ordered: Vec<_> = pixels.into_values().collect();
    ordered.sort_by_key(|s| (s.y, s.x));
    let mut d = direction;
    let mut mean = origin;
    for _ in 0..4 {
        let n = p(sign * d.y, -sign * d.x);
        let mut targets = vec![];
        for s in &ordered {
            let center = p(s.x as f64 + 0.5, s.y as f64 + 0.5);
            let offset = crate::unmix::offset(s.coverage, n.x, n.y).unwrap();
            targets.push(add(center, mul(n, offset)));
        }
        mean = mul(
            targets.iter().fold(p(0., 0.), |a, b| add(a, *b)),
            1. / targets.len() as f64,
        );
        let (mut xx, mut xy, mut yy) = (0., 0., 0.);
        for q in &targets {
            let q = sub(*q, mean);
            xx += q.x * q.x;
            xy += q.x * q.y;
            yy += q.y * q.y;
        }
        let theta = 0.5 * (2. * xy).atan2(xx - yy);
        let mut fit = p(theta.cos(), theta.sin());
        if dot(fit, direction) < 0. {
            fit = mul(fit, -1.);
        }
        if dot(fit, direction) < 0.65 {
            return (origin, direction, 0.05);
        }
        d = fit;
    }
    (mean, d, 1.)
}
fn apex_search(cs: &mut Vec<C>, old: &[C], img: &ColorImage, matte: &Matte) {
    let feature = corners(cs);
    let mut refined = 0;
    for (i, angle, _) in feature {
        if angle < 1.8 {
            continue;
        }
        let n = cs.len();
        let prev = (i + n - 1) % n;
        let ref_point = old
            .iter()
            .map(|c| c[0])
            .min_by(|a, b| dist(*a, cs[i][0]).total_cmp(&dist(*b, cs[i][0])))
            .unwrap();
        let patch = matte.patch(img, ref_point, 2);
        if patch.len() != 25 {
            continue;
        }
        let original = cs.clone();
        let Some(cache) = Patch::new(cs, &[prev, i], &patch, img, matte) else {
            continue;
        };
        let before = cache.score(cs);
        if before.0 < 1e-8 {
            continue;
        }
        if refined >= 4 {
            break;
        }
        refined += 1;
        let (a, mut u, w1) = calibrate_arm(cs, i, true, matte, img);
        let (b, mut v, w2) = calibrate_arm(cs, i, false, matte, img);
        let prior = turn(&original, i);
        let incoming_axis = axis(&original[prev]);
        let outgoing_axis = axis(&original[i]);
        let proposed = dot(u, v).clamp(-1., 1.).acos();
        let limited = proposed.clamp(prior - 0.35, prior + 0.35);
        let rot = |d: P, a: f64| {
            let (sn, co) = a.sin_cos();
            p(co * d.x - sn * d.y, sn * d.x + co * d.y)
        };
        let orientation = cross(u, v).signum();
        if incoming_axis.is_some() {
            v = rot(u, orientation * limited);
        } else if outgoing_axis.is_some() {
            u = rot(v, -orientation * limited);
        } else if (proposed - prior).abs() > 0.35 {
            let (uu, _) = crate::inverse::endpoint_tangents(&original[i]);
            let (_, vv) = crate::inverse::endpoint_tangents(&original[prev]);
            u = unit(vv);
            v = unit(uu);
        }
        let n1 = p(u.y, -u.x);
        let n2 = p(v.y, -v.x);
        let lambda = 1e-5;
        let aa = w1 * n1.x * n1.x + w2 * n2.x * n2.x + lambda;
        let ab = w1 * n1.x * n1.y + w2 * n2.x * n2.y;
        let bb = w1 * n1.y * n1.y + w2 * n2.y * n2.y + lambda;
        let ra = w1 * n1.x * dot(n1, a) + w2 * n2.x * dot(n2, b) + lambda * cs[i][0].x;
        let rb = w1 * n1.y * dot(n1, a) + w2 * n2.y * dot(n2, b) + lambda * cs[i][0].y;
        let det = aa * bb - ab * ab;
        if det > 1e-7 {
            let q = p((ra * bb - rb * ab) / det, (rb * aa - ra * ab) / det);
            if dist(q, cs[i][0]) < 3. {
                let l1 = norm(sub(cs[prev][2], cs[prev][3]));
                let l2 = norm(sub(cs[i][1], cs[i][0]));
                move_node(cs, i, q);
                cs[prev][2] = sub(q, mul(u, l1));
                cs[i][1] = add(q, mul(v, l2));
            }
        }
        let origin = cs[i][0];
        let lock_axis = axis(&cs[prev]).or(axis(&cs[i]));
        let curved_in = axis(&cs[i]).is_some();
        let mut best = cache.score(cs);
        let mut moved = false;
        for step in [0.8, 0.4, 0.2, 0.1, 0.04, 0.015, 0.005] {
            for _ in 0..2 {
                let mut progress = false;
                for dim in 0..4 {
                    if dim < 2 && lock_axis == Some(dim) {
                        continue;
                    }
                    let mut chosen = cs.clone();
                    let mut chosen_score = best;
                    for sign in [-1., 1.] {
                        let mut trial = cs.clone();
                        if dim < 2 {
                            let mut q = trial[i][0];
                            if dim == 0 {
                                q.x += sign * step
                            } else {
                                q.y += sign * step
                            }
                            if dist(q, origin) > 1.25 {
                                continue;
                            }
                            move_node(&mut trial, i, q);
                        } else {
                            let (idx, handle) = if curved_in { (prev, 2) } else { (i, 1) };
                            let q = trial[i][0];
                            let d = sub(trial[idx][handle], q);
                            let len = norm(d);
                            if dim == 2 {
                                let new_len = (len + sign * step * 0.5).clamp(0.15, 4.);
                                trial[idx][handle] = add(q, mul(unit(d), new_len));
                            } else {
                                trial[idx][handle] = add(q, rot(d, sign * step * 0.1));
                            }
                        }
                        let a = turn(&trial, i);
                        if (a - prior).abs() > 0.3501 || a < 1.8 {
                            continue;
                        }
                        let score = cache.score(&trial);
                        if score.0 + 1e-12 < chosen_score.0 && score.1 <= chosen_score.1 + 1e-10 {
                            chosen = trial;
                            chosen_score = score;
                            progress = true;
                        }
                    }
                    if chosen_score.0 < best.0 {
                        *cs = chosen;
                        best = chosen_score;
                        moved = true;
                    }
                }
                if !progress {
                    break;
                }
            }
        }
        if best.0 < before.0 && best.1 <= before.1 {
            if moved || dist(original[i][0], cs[i][0]) > 1e-4 {
                count(5, 1.);
                count(6, before.0);
                count(7, best.0);
            }
        } else {
            *cs = original;
        }
    }
}
#[derive(Clone)]
struct Target {
    edge: usize,
    t: f64,
    n: P,
    residual: f64,
}
struct Piece {
    edge: usize,
    t: f64,
    u: f64,
    a: P,
    b: P,
    n: P,
}
fn targets(cs: &[C], ss: &[Sample]) -> Vec<Target> {
    let sign = if area(cs) > 0. { 1. } else { -1. };
    let feature = corners(cs);
    let mut pieces = vec![];
    let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    let mut entries = 0;
    for (i, c) in cs.iter().enumerate() {
        // A line needs no curvature tessellation: its pixel intersection and
        // outward normal are exact even with longer parameter intervals.
        let steps = (if curve_line(c) {
            length(c) / 4.
        } else {
            length(c) * 4.
        })
        .ceil()
        .clamp(4., 2048.) as usize;
        for j in 0..steps {
            let t = j as f64 / steps as f64;
            let u = (j + 1) as f64 / steps as f64;
            let a = eval(c, t).0;
            let b = eval(c, u).0;
            let v = unit(sub(b, a));
            let n = p(sign * v.y, -sign * v.x);
            let id = pieces.len();
            pieces.push(Piece {
                edge: i,
                t,
                u,
                a,
                b,
                n,
            });
            if pieces.len() > 16384 {
                return vec![];
            }
            for y in ((a.y.min(b.y) - 2.5) / 4.).floor() as i32
                ..=((a.y.max(b.y) + 2.5) / 4.).floor() as i32
            {
                for x in ((a.x.min(b.x) - 2.5) / 4.).floor() as i32
                    ..=((a.x.max(b.x) + 2.5) / 4.).floor() as i32
                {
                    entries += 1;
                    if entries > 65536 {
                        return vec![];
                    }
                    grid.entry((x, y)).or_default().push(id);
                }
            }
        }
    }
    let mut result = vec![];
    let mut work = 0;
    for s in ss
        .iter()
        .filter(|s| s.trusted && s.coverage > 0.02 && s.coverage < 0.98)
    {
        let center = p(s.x as f64 + 0.5, s.y as f64 + 0.5);
        if feature.iter().any(|(i, _, r)| dist(cs[*i][0], center) < *r) {
            count(13, 1.);
            continue;
        }
        let Some(ids) = grid.get(&(
            (center.x / 4.).floor() as i32,
            (center.y / 4.).floor() as i32,
        )) else {
            continue;
        };
        let mut nearest = (f64::INFINITY, 0, 0.);
        let mut close = vec![];
        for &id in ids {
            work += 1;
            if work > 2_000_000 {
                return vec![];
            }
            let piece = &pieces[id];
            let v = sub(piece.b, piece.a);
            let t = (dot(sub(center, piece.a), v) / dot(v, v).max(1e-12)).clamp(0., 1.);
            let d = dist(center, add(piece.a, mul(v, t)));
            if d < 2.5 {
                close.push((id, d));
            }
            if d < nearest.0 {
                nearest = (d, id, t);
            }
        }
        if nearest.0 > 0.8 {
            continue;
        }
        let (_, id, t) = nearest;
        let piece = &pieces[id];
        if close.iter().any(|(j, d)| {
            *d < 2.25
                && dot(piece.n, pieces[*j].n) < 0.75
                && (piece.edge != pieces[*j].edge || id.abs_diff(*j) > 1)
        }) {
            count(13, 1.);
            continue;
        }
        let t = piece.t + (piece.u - piece.t) * t;
        let (q, v) = eval(&cs[piece.edge], t);
        let normal = p(sign * unit(v).y, -sign * unit(v).x);
        let (_, l) = eval(&cs[piece.edge], (t - 0.02).max(0.));
        let (_, r) = eval(&cs[piece.edge], (t + 0.02).min(1.));
        if dot(unit(l), unit(r)) < 0.995 {
            continue;
        }
        let Some(offset) = crate::unmix::offset(s.coverage, normal.x, normal.y) else {
            continue;
        };
        let target = add(center, mul(normal, offset));
        let residual = dot(sub(target, q), normal);
        if residual.abs() > 0.8 {
            continue;
        }
        result.push(Target {
            edge: piece.edge,
            t,
            n: normal,
            residual,
        });
    }
    count(12, result.len() as f64);
    result
}
fn solve_banded(mut a: Vec<Vec<f64>>, band: usize) -> Option<Vec<f64>> {
    let n = a.len();
    for i in 0..n {
        let pivot = a[i][i];
        if !pivot.is_finite() || pivot < 1e-10 {
            return None;
        }
        for k in i + 1..(i + band + 1).min(n) {
            let f = a[k][i] / pivot;
            for j in i + 1..(i + band + 1).min(n) {
                a[k][j] -= f * a[i][j];
            }
            a[k][n] -= f * a[i][n];
        }
    }
    let mut x = vec![0.; n];
    for i in (0..n).rev() {
        let mut rhs = a[i][n];
        for j in i + 1..(i + band + 1).min(n) {
            rhs -= a[i][j] * x[j];
        }
        x[i] = rhs / a[i][i];
        if !x[i].is_finite() {
            return None;
        }
    }
    Some(x)
}
fn span_recover(cs: &mut Vec<C>, ss: &[Sample], img: &ColorImage, matte: &Matte) {
    let n = cs.len();
    let mut hard = vec![false; n];
    for (i, _, _) in corners(cs) {
        hard[i] = true;
    }
    // A virtual closed-ring seam is fixed only when no genuine corner exists.
    if !hard.iter().any(|v| *v) {
        hard[0] = true;
    }
    let starts: Vec<_> = (0..n).filter(|i| hard[*i]).collect();
    let mut spans = vec![];
    let initial_targets = targets(cs, ss);
    for &start in &starts {
        let mut edges = vec![];
        let mut i = start;
        loop {
            edges.push(i);
            i = (i + 1) % n;
            if hard[i] || i == start {
                break;
            }
        }
        let mut errors: Vec<_> = initial_targets
            .iter()
            .filter(|t| edges.contains(&t.edge))
            .map(|t| t.residual.abs())
            .collect();
        if errors.len() < 8 {
            continue;
        }
        errors.sort_by(f64::total_cmp);
        let mean = errors.iter().sum::<f64>() / errors.len() as f64;
        let max = *errors.last().unwrap();
        if mean < 0.035 && max < 0.15 {
            continue;
        }
        let p95 = errors[((errors.len() - 1) as f64 * 0.95) as usize];
        spans.push((p95 + max, edges));
    }
    spans.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (rank, (_, edges)) in spans.into_iter().take(4).enumerate() {
        count(14, 1.);
        let before_span = cs.clone();
        let mut fixed = hard.clone();
        for i in 0..n {
            if axis(&cs[i]).is_some() {
                count(16, 1.);
                fixed[i] = true;
                fixed[(i + 1) % n] = true;
            }
        }
        let mut nodes = vec![];
        for &i in &edges {
            for node in [i, (i + 1) % n] {
                if !fixed[node] && !nodes.contains(&node) {
                    nodes.push(node);
                }
            }
        }
        if nodes.is_empty() {
            continue;
        }
        let m = nodes.len() * 2;
        if m > 256 {
            continue;
        }
        let mut map = vec![None; n];
        for (k, &i) in nodes.iter().enumerate() {
            map[i] = Some(2 * k);
        }
        let mut band = vec![];
        let mut seen = HashSet::new();
        for s in ss {
            if edges.iter().any(|i| {
                let c = &cs[*i];
                let minx = c.iter().map(|p| p.x).fold(f64::INFINITY, f64::min) - 2.5;
                let maxx = c.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max) + 2.5;
                let miny = c.iter().map(|p| p.y).fold(f64::INFINITY, f64::min) - 2.5;
                let maxy = c.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max) + 2.5;
                (s.x as f64) >= minx
                    && (s.x as f64) <= maxx
                    && (s.y as f64) >= miny
                    && (s.y as f64) <= maxy
            }) && seen.insert((s.x, s.y))
            {
                band.push(s.clone());
            }
        }
        for &i in [edges[0], (edges[edges.len() - 1] + 1) % n].iter() {
            for s in matte.patch(img, cs[i][0], 2) {
                if seen.insert((s.x, s.y)) {
                    band.push(s);
                }
            }
        }
        let Some(cache) = Patch::new(cs, &edges, &band, img, matte) else {
            continue;
        };
        let initial_score = cache.score(cs);
        let mut score = initial_score;
        let mut accepted = false;
        for iteration in 0..3 {
            let current_targets = if rank == 0 && iteration == 0 {
                initial_targets.clone()
            } else {
                targets(cs, ss)
            };
            let selected: Vec<_> = current_targets
                .iter()
                .filter(|t| edges.contains(&t.edge))
                .collect();
            if selected.len() < 8 {
                break;
            }
            let mut matrix = vec![vec![0.; m + 1]; m];
            for t in selected {
                let a = (1. - t.t).powi(2) * (1. + 2. * t.t);
                let b = 1. - a;
                let mut terms = vec![];
                if let Some(k) = map[t.edge] {
                    terms.push((k, a * t.n.x));
                    terms.push((k + 1, a * t.n.y));
                }
                if let Some(k) = map[(t.edge + 1) % n] {
                    terms.push((k, b * t.n.x));
                    terms.push((k + 1, b * t.n.y));
                }
                for (k, w) in &terms {
                    matrix[*k][m] += w * t.residual;
                    for (l, v) in &terms {
                        matrix[*k][*l] += w * v;
                    }
                }
            }
            for k in 0..m {
                matrix[k][k] += 0.01;
            }
            for &i in &edges {
                if let (Some(a), Some(b)) = (map[i], map[(i + 1) % n]) {
                    for d in 0..2 {
                        matrix[a + d][a + d] += 0.02;
                        matrix[b + d][b + d] += 0.02;
                        matrix[a + d][b + d] -= 0.02;
                        matrix[b + d][a + d] -= 0.02;
                    }
                }
            }
            let Some(delta) = solve_banded(matrix, 3) else {
                break;
            };
            let mut shifts = vec![p(0., 0.); n];
            for (k, &i) in nodes.iter().enumerate() {
                let mut q = p(delta[2 * k], delta[2 * k + 1]);
                let len = norm(q);
                if len > 0.4 {
                    q = mul(q, 0.4 / len);
                }
                shifts[i] = q;
            }
            if shifts.iter().all(|q| norm(*q) < 0.005) {
                break;
            }
            let mut improvement = false;
            for step in [1., 0.5, 0.25] {
                let mut trial = cs.clone();
                for i in 0..n {
                    for j in 0..4 {
                        trial[i][j] = add(
                            trial[i][j],
                            mul(shifts[if j < 2 { i } else { (i + 1) % n }], step),
                        );
                    }
                }
                round(&mut trial);
                if !control_safe(&trial, &before_span, img, 1.25) {
                    continue;
                }
                let next = cache.score(&trial);
                if next.0 + 1e-9 < score.0 && next.1 <= score.1 {
                    *cs = trial;
                    score = next;
                    improvement = true;
                    accepted = true;
                    break;
                }
            }
            if !improvement {
                break;
            }
        }
        if accepted {
            count(15, 1.);
        } else {
            *cs = before_span;
        }
    }
}
struct Patch<'a> {
    ss: &'a [Sample],
    img: &'a ColorImage,
    matte: &'a Matte,
    fixed: Vec<f64>,
    indices: Vec<usize>,
    // One exact-key entry per changed slot, at most 65536 cached f64 areas.
    // Cache lifetime is this immutable source patch, never another image/trace.
    #[cfg(feature = "runtime_cache")]
    contributions: RefCell<Vec<Option<(C, Vec<f64>)>>>,
}
impl<'a> Patch<'a> {
    fn new(
        cs: &[C],
        indices: &[usize],
        ss: &'a [Sample],
        img: &'a ColorImage,
        matte: &'a Matte,
    ) -> Option<Self> {
        runtime_scope!(13);
        let mut fixed = vec![0.; ss.len()];
        for (i, c) in cs.iter().enumerate() {
            if indices.contains(&i) {
                continue;
            }
            let p = crate::inverse::flatten(&G::Beziers(vec![*c]), 0.001)?;
            let values = crate::inverse::signed_edge_areas(&p, ss)?;
            for (a, b) in fixed.iter_mut().zip(values) {
                *a += b;
            }
        }
        Some(Self {
            ss,
            img,
            matte,
            fixed,
            indices: indices.to_vec(),
            #[cfg(feature = "runtime_cache")]
            contributions: RefCell::new(
                if !cfg!(feature = "runtime_uncached")
                    && indices
                        .len()
                        .checked_mul(ss.len())
                        .is_some_and(|n| n <= 65536)
                {
                    vec![None; indices.len()]
                } else {
                    Vec::new()
                },
            ),
        })
    }
    fn score(&self, cs: &[C]) -> (f64, f64) {
        let changed: Vec<_> = self.indices.iter().map(|&i| cs[i]).collect();
        self.score_changed(&changed)
    }
    fn score_changed(&self, changed: &[C]) -> (f64, f64) {
        runtime_scope!(14);
        runtime_count!(28, 1);
        count(2, 1.);
        let mut areas = self.fixed.clone();
        #[cfg(feature = "runtime_cache")]
        {
            let mut cache = self.contributions.borrow_mut();
            for (slot, c) in changed.iter().enumerate() {
                if let Some(Some((key, values))) = cache.get(slot) {
                    if key == c {
                        runtime_count!(26, 1);
                        for (a, b) in areas.iter_mut().zip(values) {
                            *a += b;
                        }
                        continue;
                    }
                }
                runtime_count!(27, 1);
                let Some(flat) = crate::inverse::flatten(&G::Beziers(vec![*c]), 0.001) else {
                    return (f64::INFINITY, f64::INFINITY);
                };
                let Some(v) = crate::inverse::signed_edge_areas(&flat, self.ss) else {
                    return (f64::INFINITY, f64::INFINITY);
                };
                for (a, b) in areas.iter_mut().zip(&v) {
                    *a += b;
                }
                if let Some(entry) = cache.get_mut(slot) {
                    *entry = Some((*c, v));
                }
            }
            drop(cache);
        }
        #[cfg(not(feature = "runtime_cache"))]
        {
            for c in changed {
                let Some(flat) = crate::inverse::flatten(&G::Beziers(vec![*c]), 0.001) else {
                    return (f64::INFINITY, f64::INFINITY);
                };
                let Some(v) = crate::inverse::signed_edge_areas(&flat, self.ss) else {
                    return (f64::INFINITY, f64::INFINITY);
                };
                for (a, b) in areas.iter_mut().zip(v) {
                    *a += b;
                }
            }
        }
        let mut mse = 0.;
        let mut mae = 0.;
        for (s, a) in self.ss.iter().zip(areas) {
            let t = a.abs().clamp(0., 1.);
            mse += (t - s.coverage).powi(2);
            let color = self.matte.color(t);
            let i = (s.y as usize * self.img.width + s.x as usize) * 4;
            for k in 0..3 {
                mae += (color[k] - self.img.pixels[i + k] as f64 / 255.).abs();
            }
        }
        (mse / self.ss.len() as f64, mae / self.ss.len() as f64)
    }
}
fn control_safe(cs: &[C], old: &[C], img: &ColorImage, limit: f64) -> bool {
    cs.len() == old.len()
        && area(cs) * area(old) > 0.
        && cs.iter().zip(old).all(|(a, b)| {
            a.iter().zip(b).all(|(a, b)| {
                a.x.is_finite()
                    && a.y.is_finite()
                    && a.x >= 0.
                    && a.y >= 0.
                    && a.x <= img.width as f64
                    && a.y <= img.height as f64
                    && dist(*a, *b) <= limit
            })
        })
        && self_clear(cs)
}
fn self_clear(cs: &[C]) -> bool {
    runtime_scope!(12);
    let Some(flat) = crate::inverse::flatten(&G::Beziers(cs.to_vec()), 0.001) else {
        return false;
    };
    let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    let mut work = 0;
    let mut entries = 0;
    for (i, w) in flat.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        let mut checked = HashSet::new();
        for y in (a.y.min(b.y) / 4.).floor() as i32..=(a.y.max(b.y) / 4.).floor() as i32 {
            for x in (a.x.min(b.x) / 4.).floor() as i32..=(a.x.max(b.x) / 4.).floor() as i32 {
                entries += 1;
                if entries > 65536 {
                    return false;
                }
                let cell = grid.entry((x, y)).or_default();
                for &j in cell.iter() {
                    if !checked.insert(j) {
                        continue;
                    }
                    work += 1;
                    if work > 1_000_000 {
                        return false;
                    }
                    let (c, d) = (flat[j], flat[j + 1]);
                    if [a, b]
                        .iter()
                        .any(|p| [c, d].iter().any(|q| dist(*p, *q) < 1e-7))
                    {
                        continue;
                    }
                    if cross(sub(b, a), sub(c, a)) * cross(sub(b, a), sub(d, a)) < -1e-12
                        && cross(sub(d, c), sub(a, c)) * cross(sub(d, c), sub(b, c)) < -1e-12
                    {
                        return false;
                    }
                }
                cell.push(i);
            }
        }
    }
    true
}
#[cfg(test)]
pub fn test_refine(seg: &Segment, img: &ColorImage, g: G, ss: &[Sample]) -> G {
    if !seg.is_ring() || !ss.iter().any(|s| s.trusted) {
        return g;
    }
    let Some(matte) = Matte::from(img, ss) else {
        return g;
    };
    let G::Beziers(mut cs) = g.clone() else {
        return g;
    };
    recover(&mut cs, ss, img, &matte);
    G::Beziers(cs)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(a: P, b: P) -> C {
        [
            a,
            add(a, mul(sub(b, a), 1. / 3.)),
            add(a, mul(sub(b, a), 2. / 3.)),
            b,
        ]
    }
    fn box_path() -> Vec<C> {
        let ps = [p(8., 8.), p(24., 8.), p(24., 24.), p(8., 24.), p(8., 8.)];
        ps.windows(2).map(|w| line(w[0], w[1])).collect()
    }
    fn matte(linear: bool) -> Matte {
        Matte {
            a: [0.14, 0.35, 0.72],
            b: [1.; 3],
            linear,
            render_a: [0.14, 0.35, 0.72],
            render_b: [254. / 255.; 3],
        }
    }
    fn raster(cs: &[C], matte: &Matte) -> (ColorImage, Vec<Sample>) {
        let mut img = ColorImage {
            width: 32,
            height: 32,
            pixels: vec![255; 32 * 32 * 4],
        };
        let mut ss = vec![];
        for y in 0..32 {
            for x in 0..32 {
                ss.push(Sample {
                    x,
                    y,
                    coverage: 0.,
                    trusted: true,
                });
            }
        }
        let cov = crate::inverse::coverages(
            &crate::inverse::flatten(&G::Beziers(cs.to_vec()), 0.001).unwrap(),
            &ss,
        )
        .unwrap();
        for (s, t) in ss.iter_mut().zip(cov) {
            s.coverage = t;
            let i = (s.y as usize * 32 + s.x as usize) * 4;
            for k in 0..3 {
                let c = if matte.linear {
                    crate::alpha::linear_to_srgb(
                        (1. - t) * crate::alpha::srgb_to_linear(matte.b[k])
                            + t * crate::alpha::srgb_to_linear(matte.a[k]),
                    )
                } else {
                    (1. - t) * matte.b[k] + t * matte.a[k]
                };
                img.pixels[i + k] = (c * 255.).round() as u8;
            }
        }
        (img, ss)
    }
    #[cfg(feature = "runtime_cache")]
    #[test]
    fn patch_cache_is_bit_exact_across_trials_rollback_and_cardinality_changes() {
        let cs = box_path();
        let matte = matte(false);
        let (img, ss) = raster(&cs, &matte);
        let repeated = vec![cs[0]; 9];
        let indices: Vec<_> = (0..9).collect();
        let many = vec![ss[0].clone(); 8192];
        let capped = Patch::new(&repeated, &indices, &many, &img, &matte).unwrap();
        assert!(capped.contributions.borrow().is_empty());
        let cache = Patch::new(&cs, &[0, 1], &ss, &img, &matte).unwrap();
        let uncached = Patch::new(&cs, &[0, 1], &ss, &img, &matte).unwrap();
        uncached.contributions.borrow_mut().clear();
        for dx in [0., 0.1, -0.2, 0., 0.1] {
            let mut trial = cs.clone();
            trial[0][1].x += dx;
            for changed in [&trial[..2], &trial[..3], &trial[..2]] {
                let a = cache.score_changed(changed);
                let b = uncached.score_changed(changed);
                assert_eq!(a.0.to_bits(), b.0.to_bits());
                assert_eq!(a.1.to_bits(), b.1.to_bits());
            }
        }
    }
    #[test]
    fn cached_open_edge_contributions_equal_full_closed_coverage() {
        let mut cs = box_path();
        cs[0] = [p(8., 8.), p(12., 3.), p(20., 3.), p(24., 8.)];
        for linear in [false, true] {
            let matte = matte(linear);
            let (img, ss) = raster(&cs, &matte);
            let cache = Patch::new(&cs, &[3, 0], &ss, &img, &matte).unwrap();
            for d in [-0.45, 0., 0.35] {
                let mut trial = cs.clone();
                move_node(&mut trial, 0, p(8. + d, 8. - 0.2 * d));
                let a = matte.score(&trial, &ss, &img);
                let b = cache.score(&trial);
                assert!((a.0 - b.0).abs() < 1e-12);
                assert!((a.1 - b.1).abs() < 1e-12);
            }
        }
    }
    #[test]
    fn signed_area_cache_is_additive_in_both_winding_directions() {
        let ss = (0..4)
            .flat_map(|y| {
                (0..4).map(move |x| Sample {
                    x,
                    y,
                    coverage: 0.,
                    trusted: false,
                })
            })
            .collect::<Vec<_>>();
        let mut poly = vec![
            p(0., 0.),
            p(3., 0.),
            p(3., 3.),
            p(1., 1.),
            p(0., 3.),
            p(0., 0.),
        ];
        for _ in 0..2 {
            let mut sum = vec![0.; ss.len()];
            for edge in poly.windows(2) {
                let contribution = crate::inverse::signed_edge_areas(edge, &ss).unwrap();
                for (a, b) in sum.iter_mut().zip(contribution) {
                    *a += b;
                }
            }
            let full = crate::inverse::coverages(&poly, &ss).unwrap();
            for (a, b) in sum.into_iter().zip(full) {
                assert!((a.abs().clamp(0., 1.) - b).abs() < 1e-12);
            }
            poly.reverse();
        }
    }
    #[test]
    fn banded_positive_system_recovers_known_solution_and_rejects_singular() {
        let n = 16;
        let expected = (0..n).map(|i| (i as f64 * 0.3).sin()).collect::<Vec<_>>();
        let mut a = vec![vec![0.; n + 1]; n];
        for i in 0..n {
            for j in 0..n {
                a[i][j] = if i == j {
                    4.
                } else if i.abs_diff(j) == 1 {
                    -0.5
                } else if i.abs_diff(j) == 2 {
                    0.1
                } else {
                    0.
                };
                a[i][n] += a[i][j] * expected[j];
            }
        }
        let x = solve_banded(a, 3).unwrap();
        for (a, b) in x.into_iter().zip(expected) {
            assert!((a - b).abs() < 1e-12);
        }
        assert!(solve_banded(vec![vec![0., 1.]], 3).is_none());
    }
    #[test]
    fn wedge_and_opposing_arm_pixels_are_excluded_but_remote_single_edge_is_used() {
        let cs = vec![
            line(p(32., 10.), p(35., 70.)),
            line(p(35., 70.), p(29., 70.)),
            line(p(29., 70.), p(32., 10.)),
        ];
        let query = |x, y| Sample {
            x,
            y,
            coverage: 0.5,
            trusted: true,
        };
        assert!(targets(&cs, &[query(32, 12)]).is_empty());
        assert!(targets(&cs, &[query(32, 17)]).is_empty());
        assert!(!targets(&cs, &[query(34, 60)]).is_empty());
        for (_, _, r) in corners(&cs) {
            assert!((2.25..=6.).contains(&r));
        }
    }
    #[test]
    fn topology_cannot_increase_knots_and_proper_crossings_are_rejected() {
        let cs = box_path();
        let (img, _) = raster(&cs, &matte(false));
        let mut extra = cs.clone();
        extra.push(cs[0]);
        assert!(!source_safe(&extra, &cs, &img));
        let ps = [p(8., 8.), p(24., 24.), p(8., 24.), p(24., 8.), p(8., 8.)];
        let crossed = ps.windows(2).map(|w| line(w[0], w[1])).collect::<Vec<_>>();
        assert!(!self_clear(&crossed));
        assert!(self_clear(&cs));
    }
    #[test]
    fn smooth_short_segments_without_sharp_turn_are_never_collapsed() {
        let mut cs = vec![];
        for i in 0..8 {
            let a = i as f64 * std::f64::consts::TAU / 8.;
            let b = (i + 1) as f64 * std::f64::consts::TAU / 8.;
            let k = 4. / 3. * ((b - a) / 4.).tan();
            cs.push([
                p(16. + a.cos(), 16. + a.sin()),
                p(16. + a.cos() - k * a.sin(), 16. + a.sin() + k * a.cos()),
                p(16. + b.cos() + k * b.sin(), 16. + b.sin() - k * b.cos()),
                p(16. + b.cos(), 16. + b.sin()),
            ]);
        }
        assert!(corners(&cs).is_empty());
        let old = G::Beziers(cs.clone()).into_closed_subpath();
        let (img, _) = raster(&cs, &matte(false));
        collapse_and_apex(&mut cs, &img, &matte(false), true);
        assert_eq!(G::Beziers(cs).into_closed_subpath(), old);
    }
    #[test]
    fn ownership_is_unique_and_reset_clears_worker_evidence() {
        reset();
        let cs = box_path();
        let g = G::Beziers(cs);
        let seg = Segment {
            points: vec![
                vtracer::PointI32 { x: 8, y: 8 },
                vtracer::PointI32 { x: 24, y: 8 },
                vtracer::PointI32 { x: 24, y: 24 },
                vtracer::PointI32 { x: 8, y: 24 },
                vtracer::PointI32 { x: 8, y: 8 },
            ],
            start: None,
            end: None,
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        };
        let ss = [Sample {
            x: 12,
            y: 12,
            coverage: 1.,
            trusted: true,
        }];
        capture(&g, &seg, &ss);
        let mut doc = VectorDoc::new(32, 32);
        let mut path = vtracer::ir::MultiPath::new();
        path.push(g.into_closed_subpath());
        doc.shapes.push(vtracer::ir::Shape {
            paint: vtracer::ir::Paint::Solid(vtracer::Color::new(30, 90, 180)),
            path,
        });
        let img = ColorImage {
            width: 32,
            height: 32,
            pixels: vec![255; 32 * 32 * 4],
        };
        locate(&doc, &img);
        assert_eq!(CONTEXTS.with(|c| c.borrow()[0].location), Some((0, 0)));
        doc.shapes.push(doc.shapes[0].clone());
        locate(&doc, &img);
        assert_eq!(CONTEXTS.with(|c| c.borrow()[0].location), None);
        for _ in 0..300 {
            observe_initialization(0.003, &seg, &ss, 4);
        }
        assert_eq!(initialization().len(), 1536);
        for _ in 0..4 {
            capture_deferred(&G::Beziers(box_path()), &seg, &ss);
        }
        for _ in 0..4 {
            capture(&G::Beziers(box_path()), &seg, &ss);
        }
        CONTEXTS.with(|c| {
            let c = c.borrow();
            assert_eq!(c.len(), 4);
            assert!(c.iter().all(|c| !c.deferred));
        });
        count(1, 1.);
        reset();
        assert!(values().iter().all(|n| *n == 0.));
        assert!(CONTEXTS.with(|c| c.borrow().is_empty()));
        assert!(initialization().is_empty());
    }
    #[test]
    fn deferred_ownership_uses_upstream_quantization_without_guessing_between_owners() {
        reset();
        let img = ColorImage {
            width: 32,
            height: 32,
            pixels: vec![255; 32 * 32 * 4],
        };
        let mut curves = box_path();
        for q in curves.iter_mut().flatten() {
            q.x += 0.0037;
            q.y += 0.0063;
        }
        let g = G::Beziers(curves);
        let path = crate::source_fit::quantized(g.clone(), &img).unwrap().1;
        assert_ne!(path, g.clone().into_closed_subpath());
        let seg = Segment {
            points: vec![
                vtracer::PointI32 { x: 8, y: 8 },
                vtracer::PointI32 { x: 24, y: 8 },
                vtracer::PointI32 { x: 24, y: 24 },
                vtracer::PointI32 { x: 8, y: 24 },
                vtracer::PointI32 { x: 8, y: 8 },
            ],
            start: None,
            end: None,
            left: 0,
            right: 1,
            first_dir: 0,
            last_dir: 0,
        };
        capture_deferred(
            &g,
            &seg,
            &[Sample {
                x: 12,
                y: 12,
                coverage: 1.,
                trusted: true,
            }],
        );
        let mut doc = VectorDoc::new(32, 32);
        let mut paths = vtracer::ir::MultiPath::new();
        paths.push(path);
        doc.shapes.push(vtracer::ir::Shape {
            paint: vtracer::ir::Paint::Solid(vtracer::Color::new(30, 90, 180)),
            path: paths,
        });
        locate(&doc, &img);
        assert_eq!(CONTEXTS.with(|c| c.borrow()[0].location), Some((0, 0)));
        assert_eq!(values()[29], 1.);
        doc.shapes.push(doc.shapes[0].clone());
        locate(&doc, &img);
        assert_eq!(CONTEXTS.with(|c| c.borrow()[0].location), None);
        reset();
    }
    #[test]
    fn alpha_and_third_colours_are_not_reinterpreted_as_coverage() {
        let matte = matte(false);
        let mut img = ColorImage {
            width: 8,
            height: 8,
            pixels: vec![255; 8 * 8 * 4],
        };
        img.pixels[3] = 128;
        assert!(matte.sample(&img, 0, 0).is_none());
        img.pixels[4..8].copy_from_slice(&[0, 255, 0, 255]);
        assert!(matte.sample(&img, 1, 0).is_none());
        assert!(matte.sample(&img, -1, 0).is_none());
    }
}
#[cfg(test)]
mod corner_tests {
    use super::*;
    fn line(a: P, b: P) -> C {
        [
            a,
            add(a, mul(sub(b, a), 1. / 3.)),
            add(a, mul(sub(b, a), 2. / 3.)),
            b,
        ]
    }
    fn matte() -> Matte {
        Matte {
            a: [36. / 255., 90. / 255., 183. / 255.],
            b: [1.; 3],
            linear: false,
            render_a: [36. / 255., 90. / 255., 183. / 255.],
            render_b: [1.; 3],
        }
    }
    fn image(cs: &[C]) -> ColorImage {
        let mut img = ColorImage {
            width: 32,
            height: 32,
            pixels: vec![255; 32 * 32 * 4],
        };
        let mut ss = vec![];
        for y in 0..32 {
            for x in 0..32 {
                ss.push(Sample {
                    x,
                    y,
                    coverage: 0.,
                    trusted: true,
                });
            }
        }
        let values = crate::inverse::coverages(
            &crate::inverse::flatten(&G::Beziers(cs.to_vec()), 0.001).unwrap(),
            &ss,
        )
        .unwrap();
        for (s, t) in ss.iter().zip(values) {
            let i = (s.y as usize * 32 + s.x as usize) * 4;
            for (k, a) in matte().a.into_iter().enumerate() {
                img.pixels[i + k] = ((1. - t) * 255. + t * a * 255.).round() as u8;
            }
        }
        img
    }
    #[test]
    fn tiny_bevel_is_replaced_by_one_source_verified_sharp_intersection() {
        let ps = [p(8., 8.), p(24., 8.), p(24., 24.), p(8., 24.), p(8., 8.)];
        let truth = ps.windows(2).map(|w| line(w[0], w[1])).collect::<Vec<_>>();
        let img = image(&truth);
        let old = [
            p(8.4, 8.),
            p(24., 8.),
            p(24., 24.),
            p(8., 24.),
            p(8., 8.4),
            p(8.4, 8.),
        ];
        let mut cs = old.windows(2).map(|w| line(w[0], w[1])).collect::<Vec<_>>();
        let patch = matte().patch(&img, p(8., 8.), 2);
        let before = matte().score(&cs, &patch, &img);
        collapse_and_apex(&mut cs, &img, &matte(), true);
        assert_eq!(cs.len(), 4);
        assert!(cs.iter().any(|c| dist(c[0], p(8., 8.)) < 1e-10));
        assert!(matte().score(&cs, &patch, &img).0 < before.0);
        assert!(self_clear(&cs));
    }
    #[test]
    fn source_axis_calibration_moves_only_normal_and_keeps_exact_tangents() {
        let ps = [p(8., 8.), p(24., 8.), p(24., 24.), p(8., 24.), p(8., 8.)];
        let truth = ps.windows(2).map(|w| line(w[0], w[1])).collect::<Vec<_>>();
        let img = image(&truth);
        let mut cs = truth.clone();
        move_node(&mut cs, 0, p(8.3, 8.));
        move_node(&mut cs, 3, p(8.3, 24.));
        axis_recover(&mut cs, &img, &matte());
        assert!(dist(cs[0][0], p(8., 8.)) < 1e-8);
        assert!(dist(cs[3][0], p(8., 24.)) < 1e-8);
        assert!(cs[3].iter().all(|p| (p.x - 8.).abs() < 1e-10));
        let old = G::Beziers(cs.clone()).into_closed_subpath();
        axis_recover(&mut cs, &img, &matte());
        assert_eq!(G::Beziers(cs).into_closed_subpath(), old);
    }
    #[test]
    fn dense_wedge_patch_recovers_perturbed_apex_without_rounding_the_corner() {
        let ps = [p(16., 5.), p(24., 26.), p(8., 26.), p(16., 5.)];
        let truth = ps.windows(2).map(|w| line(w[0], w[1])).collect::<Vec<_>>();
        let img = image(&truth);
        let mut cs = truth.clone();
        move_node(&mut cs, 0, p(16.2, 5.7));
        let old = cs.clone();
        let patch = matte().patch(&img, cs[0][0], 2);
        let before = matte().score(&cs, &patch, &img);
        let angle = turn(&cs, 0);
        apex_search(&mut cs, &old, &img, &matte());
        let after = matte().score(&cs, &patch, &img);
        assert!(dist(cs[0][0], truth[0][0]) < 0.25, "{:?}", cs[0][0]);
        assert!(after.0 < before.0 && after.1 <= before.1);
        assert!((turn(&cs, 0) - angle).abs() <= 0.3501);
        assert_eq!(cs.len(), truth.len());
        assert!(self_clear(&cs));
    }
}
