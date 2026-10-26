//! Source-only initialization of a rounded cap, inside final-knot recovery.
//! Ground truth, image upscaling and new contour extraction are not inputs.
use super::*;
thread_local! {static EVIDENCE:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub(super) fn reset() {
    EVIDENCE.with(|e| e.borrow_mut().clear());
}
pub(super) fn evidence() -> Vec<f64> {
    EVIDENCE.with(|e| e.borrow().clone())
}
fn note(row: [f64; 12]) {
    EVIDENCE.with(|e| {
        let mut e = e.borrow_mut();
        if e.len() < 1536 {
            e.extend(row);
        }
    });
}

#[derive(Clone)]
struct Arm {
    // Transverse position as a quadratic in normalized longitudinal distance.
    coeff: [f64; 3],
    scale: f64,
    rms: f64,
    support: usize,
    min: f64,
    max: f64,
}
impl Arm {
    fn at(&self, r: f64) -> f64 {
        let t = r / self.scale;
        self.coeff[0] + t * (self.coeff[1] + t * self.coeff[2])
    }
    fn slope(&self, r: f64) -> f64 {
        (self.coeff[1] + 2. * self.coeff[2] * r / self.scale) / self.scale
    }
}
struct Hypothesis {
    q: P,
    u: P,
    v: P,
    uncertainty: f64,
    condition: f64,
    line: Option<(P, P, bool)>,
}
fn support_span(samples: &[(f64, f64)]) -> Option<f64> {
    let near = samples.iter().min_by(|a, b| a.0.total_cmp(&b.0))?;
    let far = samples.iter().max_by(|a, b| a.0.total_cmp(&b.0))?;
    Some((near.0 - far.0).hypot(near.1 - far.1))
}

fn arm(
    cs: &[C],
    index: usize,
    incoming: bool,
    origin: P,
    depth: P,
    side: P,
    radius: f64,
    img: &ColorImage,
    matte: &Matte,
) -> Option<Arm> {
    let path = arm_samples(cs, index, incoming, 3., radius);
    let opposite = arm_samples(cs, index, !incoming, 0., radius + 2.);
    let sign = if area(cs) > 0. { 1. } else { -1. };
    let mut pixels = HashMap::new();
    for (q, v) in &path {
        let normal = p(sign * v.y, -sign * v.x);
        // An exact grid-aligned side can have no fractional pixels at all.
        // Two opposite full-pixel constraints bound its location at their
        // common pixel-square edge. This is not alpha-as-distance inversion.
        let target = if v.x.abs() < 1e-8 && (q.x - q.x.round()).abs() < 0.01 {
            Some(p(q.x.round(), q.y.floor() + 0.5))
        } else if v.y.abs() < 1e-8 && (q.y - q.y.round()).abs() < 0.01 {
            Some(p(q.x.floor() + 0.5, q.y.round()))
        } else {
            None
        };
        if let Some(target) = target {
            let inside = sub(target, mul(normal, 0.5));
            let outside = add(target, mul(normal, 0.5));
            let known = matte
                .sample(img, inside.x.floor() as i32, inside.y.floor() as i32)
                .zip(matte.sample(img, outside.x.floor() as i32, outside.y.floor() as i32))
                .is_some_and(|(a, b)| a.coverage > 0.999 && b.coverage < 0.001);
            if known && !opposite.iter().any(|(q, _)| dist(*q, target) < 2.25) {
                pixels
                    .entry((target.x.floor() as i32, target.y.floor() as i32))
                    .or_insert(target);
            }
        }
        for s in matte.patch(img, *q, 1) {
            if !(0.02..0.98).contains(&s.coverage) {
                continue;
            }
            let center = p(s.x as f64 + 0.5, s.y as f64 + 0.5);
            // Keep the established multi-edge safety distance. A source pixel
            // near both arms is never inverted into an independent target.
            if opposite.iter().any(|(q, _)| dist(*q, center) < 2.25) {
                continue;
            }
            let normal = p(sign * v.y, -sign * v.x);
            let Some(offset) = crate::unmix::offset(s.coverage, normal.x, normal.y) else {
                continue;
            };
            let target = add(center, mul(normal, offset));
            if dist(target, *q) > 1.5 {
                continue;
            }
            pixels.entry((s.x, s.y)).or_insert(target);
        }
    }
    if pixels.len() < 5 {
        note([
            origin.x,
            origin.y,
            radius,
            incoming as u8 as f64,
            1.,
            pixels.len() as f64,
            0.,
            0.,
            0.,
            0.,
            0.,
            0.,
        ]);
        return None;
    }
    let mut points: Vec<_> = pixels.into_iter().collect();
    points.sort_by_key(|(key, _)| *key);
    let samples: Vec<_> = points
        .iter()
        .map(|(_, q)| {
            let q = sub(*q, origin);
            (dot(q, depth), dot(q, side))
        })
        .collect();
    let min = samples.iter().map(|q| q.0).fold(f64::INFINITY, f64::min);
    let max = samples
        .iter()
        .map(|q| q.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let physical_span = support_span(&samples)?;
    if min < 0. || physical_span + 1e-7 < 4. {
        note([
            origin.x,
            origin.y,
            radius,
            incoming as u8 as f64,
            2.,
            samples.len() as f64,
            min,
            max,
            0.,
            0.,
            0.,
            0.,
        ]);
        return None;
    }
    let mut weights = vec![1.; samples.len()];
    let mut coeff = [0.; 3];
    let mut rms = 0.;
    for _ in 0..3 {
        let mut matrix = vec![vec![0.; 4]; 3];
        for ((r, s), w) in samples.iter().zip(&weights) {
            let t = r / radius;
            let row = [1., t, t * t];
            for i in 0..3 {
                matrix[i][3] += w * row[i] * s;
                for j in 0..3 {
                    matrix[i][j] += w * row[i] * row[j];
                }
            }
        }
        for (i, row) in matrix.iter_mut().enumerate() {
            row[i] += 1e-9;
        }
        let fit = solve_banded(matrix, 2)?;
        coeff.copy_from_slice(&fit);
        let mut sum = 0.;
        for ((r, s), w) in samples.iter().zip(weights.iter_mut()) {
            let t = r / radius;
            let residual = s - coeff[0] - t * (coeff[1] + t * coeff[2]);
            sum += residual.powi(2);
            *w = 1. / (1. + (residual / 0.12).powi(2));
        }
        rms = (sum / samples.len() as f64).sqrt();
    }
    if rms > 0.18 || coeff.iter().any(|v| !v.is_finite()) {
        note([
            origin.x,
            origin.y,
            radius,
            incoming as u8 as f64,
            3.,
            samples.len() as f64,
            min,
            max,
            rms,
            coeff[0],
            coeff[1],
            coeff[2],
        ]);
        return None;
    }
    note([
        origin.x,
        origin.y,
        radius,
        incoming as u8 as f64,
        0.,
        samples.len() as f64,
        min,
        max,
        rms,
        coeff[0],
        coeff[1],
        coeff[2],
    ]);
    Some(Arm {
        coeff,
        scale: radius,
        rms,
        support: samples.len(),
        min,
        max,
    })
}

fn hypothesis(a: &Arm, b: &Arm, origin: P, depth: P, side: P) -> Option<Hypothesis> {
    let values: [f64; 3] = std::array::from_fn(|i| {
        a.coeff[i] / a.scale.powi(i as i32) - b.coeff[i] / b.scale.powi(i as i32)
    });
    let mut roots = vec![];
    if values[2].abs() > 1e-7 {
        let disc = values[1].powi(2) - 4. * values[2] * values[0];
        if disc >= 0. {
            let q = -0.5 * (values[1] + values[1].signum() * disc.sqrt());
            if q.abs() > 1e-10 {
                roots.extend([q / values[2], values[0] / q]);
            }
        }
    } else if values[1].abs() > 1e-6 {
        roots.push(-values[0] / values[1]);
    }
    let r = roots
        .into_iter()
        .filter(|r| r.is_finite() && *r >= -6. && *r <= 1.)
        .min_by(|a, b| a.abs().total_cmp(&b.abs()))?;
    let slope_a = a.slope(r);
    let slope_b = b.slope(r);
    let u = unit(mul(add(depth, mul(side, slope_a)), -1.));
    let v = unit(add(depth, mul(side, slope_b)));
    let cosine = dot(u, v).abs().min(1. - 1e-12);
    let condition = (1. + cosine) / (1. - cosine);
    // Quantization floor plus extrapolation leverage. An almost parallel pair
    // cannot claim a precise apex simply because its least-squares residual is low.
    let uncertainty = [a, b]
        .iter()
        .map(|arm| {
            arm.rms.max(0.02) * (1. + ((arm.min - r).max(0.) / (arm.max - arm.min)).powi(2))
                / (arm.support as f64).sqrt()
        })
        .sum::<f64>()
        / (slope_a - slope_b).abs().max(1e-8);
    if condition > 1500. || uncertainty > 1.25 || dot(u, v) > -0.5 {
        note([
            origin.x,
            origin.y,
            a.scale,
            2.,
            5.,
            0.,
            condition,
            uncertainty,
            r,
            0.,
            0.,
            0.,
        ]);
        return None;
    }
    let q = add(
        add(origin, mul(depth, r)),
        mul(side, (a.at(r) + b.at(r)) * 0.5),
    );
    note([
        origin.x,
        origin.y,
        a.scale,
        2.,
        0.,
        0.,
        condition,
        uncertainty,
        r,
        q.x,
        q.y,
        0.,
    ]);
    (dist(q, origin) < 6.).then_some(Hypothesis {
        q,
        u,
        v,
        uncertainty,
        condition,
        line: None,
    })
}

fn coverage_hypotheses(
    pairs: &[(Arm, Arm)],
    patch: &[Sample],
    origin: P,
    depth: P,
    side: P,
) -> Vec<Hypothesis> {
    let mut result = vec![];
    if pairs.len() < 2 {
        return result;
    }
    for (index, (a, b)) in pairs.iter().enumerate() {
        let tangent = |arm: &Arm| unit(add(depth, mul(side, arm.slope(arm.min))));
        let u = mul(tangent(a), -1.);
        let v = tangent(b);
        let consistent = pairs.iter().enumerate().any(|(j, (aa, bb))| {
            j != index
                && dot(tangent(a), tangent(aa)) > 0.995
                && dot(tangent(b), tangent(bb)) > 0.995
        });
        if !consistent || dot(u, v) > -0.5 {
            continue;
        }
        let linear = |arm: &Arm| arm.rms < 0.03 && (arm.coeff[2] / arm.scale.powi(2)).abs() < 1e-4;
        let (line, incoming) = if linear(a) {
            (a, true)
        } else if linear(b) {
            (b, false)
        } else {
            continue;
        };
        // A grid-certified or strongly linear source arm constrains transverse
        // position. Mixed pixels ABOVE the rounded cap are used only as a
        // support interval, never inverted as independent half-planes.
        let first = patch
            .iter()
            .filter_map(|s| {
                if !s.trusted || s.coverage < 0.02 {
                    return None;
                }
                let q = sub(p(s.x as f64 + 0.5, s.y as f64 + 0.5), origin);
                let r = dot(q, depth);
                (r < -0.9 && (dot(q, side) - line.at(r)).abs() < 1.75).then_some(r)
            })
            .min_by(f64::total_cmp);
        let Some(first) = first else { continue };
        let cosine = dot(u, v).abs().min(1. - 1e-12);
        let condition = (1. + cosine) / (1. - cosine);
        let uncertainty =
            0.5 * (depth.x.abs() + depth.y.abs()) + a.rms.max(b.rms).max(0.02) * condition.sqrt();
        if condition > 1500. || uncertainty > 1.25 {
            continue;
        }
        let point = add(origin, mul(side, line.coeff[0]));
        let direction = unit(add(depth, mul(side, line.coeff[1] / line.scale)));
        for offset in [0., -0.5, 0.5] {
            let r = first - 0.5 + offset;
            result.push(Hypothesis {
                q: add(add(origin, mul(depth, r)), mul(side, line.at(r))),
                u,
                v,
                uncertainty,
                condition,
                line: Some((point, direction, incoming)),
            });
        }
        break;
    }
    result
}
fn clamp_position(q: P, origin: P, line: Option<(P, P, bool)>) -> Option<P> {
    if let Some((point, direction, _)) = line {
        let foot = sub(point, mul(direction, dot(sub(point, origin), direction)));
        let radius = (9. - dist(foot, origin).powi(2)).max(0.).sqrt();
        if radius < 0.01 {
            return None;
        }
        Some(add(
            foot,
            mul(
                direction,
                dot(sub(q, foot), direction).clamp(-radius, radius),
            ),
        ))
    } else {
        let delta = sub(q, origin);
        Some(if norm(delta) > 3. {
            add(origin, mul(unit(delta), 3.))
        } else {
            q
        })
    }
}

fn propose(cs: &[C], i: usize, q: P, u: P, v: P, handles: [f64; 4]) -> Vec<C> {
    let mut result = cs.to_vec();
    let prev = (i + cs.len() - 1) % cs.len();
    let (start, _) = crate::inverse::endpoint_tangents(&cs[prev]);
    let (_, end) = crate::inverse::endpoint_tangents(&cs[i]);
    let a = cs[prev][0];
    let b = cs[i][3];
    result[prev] = [
        a,
        add(a, mul(unit(start), handles[0])),
        sub(q, mul(u, handles[1])),
        q,
    ];
    result[i] = [
        q,
        add(q, mul(v, handles[2])),
        sub(b, mul(unit(end), handles[3])),
        b,
    ];
    result
}

fn local_clear(cs: &[C], i: usize) -> bool {
    let prev = (i + cs.len() - 1) % cs.len();
    let q = cs[i][0];
    let a = cs[prev][0];
    let b = cs[i][3];
    let depth = unit(add(unit(sub(a, q)), unit(sub(b, q))));
    let side = p(-depth.y, depth.x);
    let sa = dot(sub(a, q), side);
    let sb = dot(sub(b, q), side);
    if sa * sb >= -1e-8 {
        return false;
    }
    for (edge, sign) in [(prev, sa.signum()), (i, sb.signum())] {
        let c = cs[edge];
        let chord = sub(c[3], c[0]);
        let len = norm(chord);
        if len < 0.1 || c.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return false;
        }
        let projection = |p: P| dot(sub(p, c[0]), unit(chord));
        let h1 = projection(c[1]);
        let h2 = projection(c[2]);
        // Monotone chord projection rules out a loop within either cubic.
        if h1 < -1e-7 || h2 < h1 - 1e-7 || h2 > len + 1e-7 {
            return false;
        }
        // Opposite convex half-planes separate the two arms except at the apex.
        if c.iter().any(|p| sign * dot(sub(*p, q), side) < -1e-7) {
            return false;
        }
    }
    true
}

pub(super) fn initialize(cs: &mut Vec<C>, img: &ColorImage, matte: &Matte) -> bool {
    let started = now();
    let baseline = cs.clone();
    let n = cs.len();
    let mut candidates = vec![];
    for i in 0..n {
        let prev = (i + n - 1) % n;
        let a = cs[prev][0];
        let q = cs[i][0];
        let b = cs[i][3];
        let u = unit(sub(q, a));
        let v = unit(sub(b, q));
        let angle = dot(u, v).clamp(-1., 1.).acos();
        // A rounded hairpin in the fitted geometry, not every raster turn.
        if angle > 2.0
            && turn(cs, i) < 0.65
            && dist(a, q) > 0.5
            && dist(b, q) > 0.5
            && dist(a, q).min(dist(b, q)) < 8.
        {
            candidates.push((angle, i));
        }
    }
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut accepted = false;
    for (_, i) in candidates.into_iter().take(3) {
        count(20, 1.);
        let prev = (i + n - 1) % n;
        let origin = cs[i][0];
        let depth = unit(sub(
            unit(sub(cs[i][3], origin)),
            unit(sub(origin, cs[prev][0])),
        ));
        let side = p(-depth.y, depth.x);
        let mut hypotheses = vec![];
        let mut pairs = vec![];
        let patch = matte.patch(img, origin, 6);
        if patch.len() != 169 {
            continue;
        }
        for radius in [12., 16., 20., 28.] {
            let Some(a) = arm(cs, i, true, origin, depth, side, radius, img, matte) else {
                continue;
            };
            let Some(b) = arm(cs, i, false, origin, depth, side, radius, img, matte) else {
                continue;
            };
            if let Some(h) = hypothesis(&a, &b, origin, depth, side) {
                count(21, 1.);
                count(25, h.condition);
                count(26, h.uncertainty);
                hypotheses.push(h);
            }
            pairs.push((a, b));
        }
        // A short arm may offer just one coherent large window. Probe a
        // shorter window based on its innermost actual support, rather than
        // crossing the next junction to obtain a second nominal scale.
        if pairs.len() == 1 {
            let (a, b) = &pairs[0];
            let radius = a.scale - 0.25 * (a.scale - a.min.max(b.min));
            if let Some(aa) = arm(cs, i, true, origin, depth, side, radius, img, matte) {
                if let Some(bb) = arm(cs, i, false, origin, depth, side, radius, img, matte) {
                    if aa.support != a.support || bb.support != b.support {
                        pairs.push((aa, bb));
                    }
                }
            }
        }
        // At least two distinct support scales must agree before extrapolation.
        let positions: Vec<_> = hypotheses.iter().map(|h| h.q).collect();
        hypotheses.retain(|a| positions.iter().filter(|b| dist(a.q, **b) < 1.25).count() >= 2);
        hypotheses.extend(coverage_hypotheses(&pairs, &patch, origin, depth, side));
        if hypotheses.is_empty() {
            count(23, 1.);
            continue;
        }
        let Some(cache) = Patch::new(cs, &[prev, i], &patch, img, matte) else {
            continue;
        };
        let before = cache.score(cs);
        if before.0 < 1e-5 {
            continue;
        }
        let original = cs.clone();
        let mut best = before;
        let mut chosen = cs.clone();
        let mut chosen_line = None;
        for h in hypotheses.into_iter().take(3) {
            let Some(q) = clamp_position(h.q, origin, h.line) else {
                continue;
            };
            let mut u = unit(add(h.u, unit(sub(q, original[prev][0]))));
            let mut v = unit(add(h.v, unit(sub(original[i][3], q))));
            if let Some((_, direction, incoming)) = h.line {
                if incoming {
                    u = mul(direction, -1.)
                } else {
                    v = direction;
                }
            }
            let handles = [
                dist(original[prev][0], q) / 3.,
                dist(original[prev][0], q) / 3.,
                dist(original[i][3], q) / 3.,
                dist(original[i][3], q) / 3.,
            ];
            let trial = propose(&original, i, q, u, v, handles);
            let score = cache.score(&trial);
            if score.0 < best.0 && score.1 <= best.1 && local_clear(&trial, i) {
                chosen = trial;
                best = score;
                chosen_line = h.line;
            }
        }
        if best.0 >= before.0 {
            continue;
        }
        // Low-dimensional source search. The original two-dimensional region
        // covers both arms of a wedge, including all ambiguous apex pixels.
        for step in [0.4, 0.2, 0.1, 0.04, 0.015] {
            for dim in 0..8 {
                let mut update = chosen.clone();
                let mut value = best;
                for sign in [-1., 1.] {
                    let mut trial = chosen.clone();
                    if dim < 2 {
                        let mut q = trial[i][0];
                        if dim == 0 {
                            q.x += sign * step
                        } else {
                            q.y += sign * step
                        }
                        let Some(q) = clamp_position(q, origin, chosen_line) else {
                            continue;
                        };
                        move_node(&mut trial, i, q);
                    } else if dim < 6 {
                        let (edge, handle, anchor) = [
                            (prev, 1, original[prev][0]),
                            (prev, 2, trial[i][0]),
                            (i, 1, trial[i][0]),
                            (i, 2, original[i][3]),
                        ][dim - 2];
                        let d = sub(trial[edge][handle], anchor);
                        let len = norm(d);
                        let next = (len + sign * step).max(0.1);
                        if next > len * 1.5 + 0.5 {
                            continue;
                        }
                        trial[edge][handle] = add(anchor, mul(unit(d), next));
                    } else {
                        let incoming = dim == 6;
                        if chosen_line.is_some_and(|(_, _, known)| known == incoming) {
                            continue;
                        }
                        let (edge, handle) = if incoming { (prev, 2) } else { (i, 1) };
                        let q = trial[i][0];
                        let d = sub(trial[edge][handle], q);
                        let (sn, co) = (sign * step * 0.1).sin_cos();
                        trial[edge][handle] = add(q, p(co * d.x - sn * d.y, sn * d.x + co * d.y));
                    }
                    if turn(&trial, i) < 2.0 {
                        continue;
                    }
                    if !local_clear(&trial, i) {
                        continue;
                    }
                    let score = cache.score(&trial);
                    if score.0 + 1e-12 < value.0 && score.1 <= value.1 {
                        update = trial;
                        value = score;
                    }
                }
                if value.0 < best.0 {
                    chosen = update;
                    best = value;
                }
            }
        }
        // Source sensitivity at a quarter pixel: a flat likelihood cannot
        // justify creating a sharp corner, even when aggregate pixel loss falls.
        let contrast = matte
            .a
            .iter()
            .zip(matte.b)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>();
        let floor = (1. / 255f64).powi(2) / contrast.max(0.01) / patch.len() as f64;
        let direction = chosen_line.map_or(depth, |(_, v, _)| v);
        let mut distinguishable = false;
        for sign in [-1., 1.] {
            let Some(q) = clamp_position(
                add(chosen[i][0], mul(direction, sign * 0.25)),
                origin,
                chosen_line,
            ) else {
                continue;
            };
            if dist(q, chosen[i][0]) < 0.15 {
                continue;
            }
            let mut alternative = chosen.clone();
            move_node(&mut alternative, i, q);
            if (cache.score(&alternative).0 - best.0).abs() <= floor {
                distinguishable = false;
                break;
            }
            distinguishable = true;
        }
        if best.0 < before.0 * 0.85
            && best.1 < before.1
            && distinguishable
            && self_clear(&chosen)
            && source_safe(&chosen, &baseline, img)
        {
            *cs = chosen;
            accepted = true;
            count(22, 1.);
            count(27, before.0);
            count(28, best.0);
        }
    }
    count(24, now() - started);
    accepted
}

/// Separate hypothesis class: an existing, genuinely discontinuous apex.
/// Only deferred components without accepted rounded-cap initialization enter.
/// Agreement/conditioning and the original trust region are not relaxed.
pub(super) fn refine_sharp(cs: &mut Vec<C>, img: &ColorImage, matte: &Matte) -> bool {
    let started = now();
    let old = cs.clone();
    let n = cs.len();
    let selected = (0..n)
        .filter(|&i| {
            if turn(cs, i) <= 0.65 {
                return false;
            }
            let a = arm_samples(cs, i, true, 3., 10.);
            let b = arm_samples(cs, i, false, 3., 10.);
            a.last().zip(b.last()).is_some_and(|((a, _), (b, _))| {
                dot(unit(sub(cs[i][0], *a)), unit(sub(*b, cs[i][0]))) < -0.8
            })
        })
        .max_by(|&a, &b| turn(cs, a).total_cmp(&turn(cs, b)));
    let Some(i) = selected else { return false };
    count(32, 1.);
    let origin = cs[i][0];
    let prev = (i + n - 1) % n;
    let depth = unit(sub(
        unit(sub(cs[i][3], origin)),
        unit(sub(origin, cs[prev][0])),
    ));
    let side = p(-depth.y, depth.x);
    let mut hypotheses = vec![];
    for radius in [12., 16., 20., 28.] {
        let Some(a) = arm(cs, i, true, origin, depth, side, radius, img, matte) else {
            continue;
        };
        let Some(b) = arm(cs, i, false, origin, depth, side, radius, img, matte) else {
            continue;
        };
        if let Some(h) = hypothesis(&a, &b, origin, depth, side) {
            hypotheses.push(h);
        }
    }
    let positions: Vec<_> = hypotheses.iter().map(|h| h.q).collect();
    hypotheses.retain(|h| positions.iter().filter(|q| dist(h.q, **q) < 1.25).count() >= 2);
    let patch = matte.patch(img, origin, 6);
    let mut changed = false;
    if patch.len() == 169 && !hypotheses.is_empty() {
        if let Some(cache) = Patch::new(cs, &[prev, i], &patch, img, matte) {
            let before = cache.score(cs);
            let mut best = before;
            let mut chosen = old.clone();
            for h in hypotheses.into_iter().take(3) {
                // Do not clamp a distant/ill-conditioned extrapolated apex into
                // an apparently supported update at the edge of the budget.
                if dist(h.q, origin) > 3. {
                    continue;
                }
                let handles = [
                    dist(old[prev][0], old[prev][1]),
                    dist(old[prev][0], h.q) / 3.,
                    dist(old[i][3], h.q) / 3.,
                    dist(old[i][2], old[i][3]),
                ];
                let mut trial = propose(&old, i, h.q, h.u, h.v, handles);
                round(&mut trial);
                if turn(&trial, i) < 2.6 || !local_clear(&trial, i) {
                    continue;
                }
                let score = cache.score(&trial);
                if score.0 < best.0 && score.1 < best.1 {
                    best = score;
                    chosen = trial;
                }
            }
            if best.0 < before.0 * 0.85
                && best.1 < before.1
                && self_clear(&chosen)
                && source_safe(&chosen, &old, img)
            {
                *cs = chosen;
                changed = true;
                count(33, 1.);
            }
        }
    }
    note([
        origin.x,
        origin.y,
        0.,
        3.,
        if changed { 0. } else { 30. },
        0.,
        0.,
        0.,
        0.,
        cs[i][0].x,
        cs[i][0].y,
        0.,
    ]);
    count(34, now() - started);
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn model(slope: f64, scale: f64) -> Arm {
        Arm {
            coeff: [slope * 2., slope * scale, 0.],
            scale,
            rms: 0.005,
            support: 16,
            min: 3.,
            max: 20.,
        }
    }
    #[test]
    fn intersections_are_scale_normalized_and_reject_nearly_parallel_arms() {
        let k = (8f64.to_radians()).tan();
        let a = model(k, 16.);
        let b = model(-k, 24.);
        let h = hypothesis(&a, &b, p(16., 8.), p(0., 1.), p(-1., 0.)).unwrap();
        assert!(dist(h.q, p(16., 6.)) < 1e-8);
        assert!(h.uncertainty < 1.25);
        let k = (0.25f64.to_radians()).tan();
        assert!(
            hypothesis(
                &model(k, 16.),
                &model(-k, 16.),
                p(16., 8.),
                p(0., 1.),
                p(-1., 0.)
            )
            .is_none()
        );
    }
    #[test]
    fn short_windows_measure_physical_support_instead_of_projected_roundoff() {
        let angle = 0.001f64;
        let samples: Vec<_> = (0..=4)
            .map(|i| (i as f64 * angle.cos(), i as f64 * angle.sin()))
            .collect();
        assert!(samples[4].0 - samples[0].0 < 4.);
        assert!((support_span(&samples).unwrap() - 4.).abs() < 1e-12);
        assert!(support_span(&[]).is_none());
    }
    #[test]
    fn coverage_hypotheses_require_two_coherent_arms_and_missing_source_support() {
        let k = 0.13;
        let pairs = vec![
            (model(k, 20.), model(-k, 20.)),
            (model(k, 16.), model(-k, 16.)),
        ];
        let mut patch = vec![Sample {
            x: 15,
            y: 5,
            coverage: 0.08,
            trusted: true,
        }];
        let make = |pairs: &[(Arm, Arm)], patch: &[Sample]| {
            coverage_hypotheses(pairs, patch, p(16., 8.), p(0., 1.), p(-1., 0.))
        };
        assert_eq!(make(&pairs, &patch).len(), 3);
        assert!(make(&pairs[..1], &patch).is_empty());
        patch[0].trusted = false;
        assert!(make(&pairs, &patch).is_empty());
        patch[0].trusted = true;
        patch[0].coverage = 0.;
        assert!(make(&pairs, &patch).is_empty());
        patch[0].coverage = 0.08;
        patch[0].y = 8;
        assert!(make(&pairs, &patch).is_empty());
    }
    #[test]
    fn tangent_disagreement_rejects_an_apparently_supported_cap() {
        let pairs = vec![
            (model(0.15, 20.), model(-0.15, 20.)),
            (model(0.7, 16.), model(-0.6, 16.)),
        ];
        let patch = vec![Sample {
            x: 15,
            y: 5,
            coverage: 0.08,
            trusted: true,
        }];
        assert!(coverage_hypotheses(&pairs, &patch, p(16., 8.), p(0., 1.), p(-1., 0.)).is_empty());
    }
    #[test]
    fn line_trust_region_is_rotation_invariant_and_never_moves_transversely() {
        for i in 0..36 {
            let angle = i as f64 * std::f64::consts::PI / 18.;
            let direction = p(angle.cos(), angle.sin());
            let normal = p(-direction.y, direction.x);
            let origin = p(12., 12.);
            let point = add(origin, mul(normal, 0.3));
            let q = clamp_position(
                add(point, mul(direction, 8.)),
                origin,
                Some((point, direction, true)),
            )
            .unwrap();
            assert!(dist(q, origin) <= 3. + 1e-12);
            assert!(dot(sub(q, point), normal).abs() < 1e-12);
            assert!(
                clamp_position(
                    q,
                    origin,
                    Some((add(origin, mul(normal, 4.)), direction, true))
                )
                .is_none()
            );
        }
    }
    fn line(a: P, b: P) -> C {
        [
            a,
            add(a, mul(sub(b, a), 1. / 3.)),
            add(a, mul(sub(b, a), 2. / 3.)),
            b,
        ]
    }
    #[test]
    fn cheap_local_guard_proves_arm_separation_and_rejects_folded_handles() {
        let q = p(16., 4.);
        let a = p(14., 20.);
        let b = p(18., 20.);
        let good = vec![line(q, b), line(b, a), line(a, q)];
        assert!(local_clear(&good, 0));
        assert!(self_clear(&good));
        let mut fold = good.clone();
        fold[2][1] = p(14., 25.);
        assert!(!local_clear(&fold, 0));
        let mut crossed = good;
        crossed[2][2] = p(19., 8.);
        assert!(!local_clear(&crossed, 0));
    }
    #[test]
    fn diagnostics_are_bounded_and_reset_with_the_worker_context() {
        reset();
        for _ in 0..200 {
            note([0.; 12]);
        }
        assert_eq!(evidence().len(), 1536);
        reset();
        assert!(evidence().is_empty());
    }
}
