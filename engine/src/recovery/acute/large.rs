//! Separate experimental contract. Never resets the original exported baseline.
//! Only a source-certified two-arm replacement may exceed legacy drift limits.
use super::*;
thread_local! {static TRACE:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub(crate) fn reset() {
    TRACE.with(|r| r.borrow_mut().clear());
}
pub(crate) fn evidence() -> Vec<f64> {
    TRACE.with(|r| r.borrow().clone())
}
fn record(row: [f64; 48]) {
    TRACE.with(|r| {
        let mut r = r.borrow_mut();
        if r.len() < 3072 {
            r.extend(row);
        }
    });
}

pub(crate) struct Certified {
    geometry: Vec<C>,
    original: Vec<C>,
    index: usize,
    limit: f64,
}
impl Certified {
    pub(crate) fn geometry(&self) -> &[C] {
        &self.geometry
    }
    pub(crate) fn validate(&self, cs: &[C], old: &[C], img: &ColorImage) -> bool {
        // An immutable certificate covers exactly this geometry and this original.
        // No subsequent span recovery or incremental-baseline reset is allowed.
        cs == self.geometry
            && old == self.original
            && unchanged_others(cs, old, self.index)
            && geometry_safe(cs, old, img)
            && local_clear(cs, self.index)
            && turn(cs, self.index) > 2.6
            && crate::inverse::displacement_bound(
                &G::Beziers(old.to_vec()),
                &G::Beziers(cs.to_vec()),
                self.limit,
            )
    }
}
fn unchanged_others(cs: &[C], old: &[C], i: usize) -> bool {
    let prev = (i + old.len() - 1) % old.len();
    cs.len() == old.len()
        && cs.iter().zip(old).enumerate().all(|(k, (a, b))| {
            if k == prev {
                a[0] == b[0]
            } else if k == i {
                a[3] == b[3]
            } else {
                a == b
            }
        })
}
fn supported(models: &[(Arm, Arm, Hypothesis)], origin: P) -> bool {
    if models.len() < 3 {
        return false;
    }
    models.iter().all(|(a, b, h)| {
        dist(h.q, origin) > 3.
            && h.condition < 400.
            && h.uncertainty < 0.35
            && [a, b]
                .iter()
                .all(|a| a.support >= 7 && a.max - a.min >= 6. && a.rms < 0.025)
            && models.iter().all(|(_, _, other)| {
                dist(h.q, other.q) < 0.25 && dot(h.u, other.u) > 0.999 && dot(h.v, other.v) > 0.999
            })
    })
}
fn pixel_patch(
    old: &[C],
    new: &[C],
    i: usize,
    img: &ColorImage,
    matte: &Matte,
) -> Option<Vec<Sample>> {
    let prev = (i + old.len() - 1) % old.len();
    let points: Vec<_> = [old, new]
        .into_iter()
        .flat_map(|cs| [prev, i].into_iter().flat_map(move |j| cs[j]))
        .collect();
    let x0 = (points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min) - 2.).floor() as i32;
    let y0 = (points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min) - 2.).floor() as i32;
    let x1 = (points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max) + 2.).ceil() as i32;
    let y1 = (points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max) + 2.).ceil() as i32;
    if x0 < 1
        || y0 < 1
        || x1 >= img.width as i32 - 1
        || y1 >= img.height as i32 - 1
        || (x1 - x0 + 1) * (y1 - y0 + 1) > 2048
    {
        return None;
    }
    let mut patch = vec![];
    for y in y0..=y1 {
        for x in x0..=x1 {
            patch.push(matte.sample(img, x, y)?);
        }
    }
    Some(patch)
}
fn coverage(cs: &[C], ss: &[Sample]) -> Option<Vec<f64>> {
    let flat = crate::inverse::flatten(&G::Beziers(cs.to_vec()), 0.001)?;
    crate::inverse::coverages(&flat, ss)
}
fn tip_support(old: &[C], new: &[C], ss: &[Sample]) -> Option<(usize, f64, f64, f64)> {
    let (a, b) = (coverage(old, ss)?, coverage(new, ss)?);
    let mut supported = 0;
    let (mut ea, mut eb, mut peak_a, mut peak_b) = (0., 0., 0f64, 0f64);
    for ((s, a), b) in ss.iter().zip(a).zip(b) {
        if s.coverage > 0.02 && a + 0.02 < s.coverage && b > a + 0.02 {
            supported += 1;
        }
        // Positive missing mass is necessary but not sufficient: reject new paint
        // in known background, or erosion of known fully covered source pixels.
        if (s.coverage < 0.005 && b > 0.1 && b > a + 0.05)
            || (s.coverage > 0.995 && b < 0.9 && b + 0.05 < a)
        {
            return None;
        }
        ea += (a - s.coverage).powi(2);
        eb += (b - s.coverage).powi(2);
        peak_a = peak_a.max((a - s.coverage).abs());
        peak_b = peak_b.max((b - s.coverage).abs());
    }
    (supported >= 3 && eb < ea * 0.75 && peak_b <= peak_a).then_some((
        supported,
        ea / ss.len() as f64,
        eb / ss.len() as f64,
        peak_b,
    ))
}
// Endpoint-inclusive two-sided distance, .002px flattening, <=.5px sampling.
// The actual safety proof additionally uses inverse::displacement_bound's
// conservative .254px margin and work caps, not this diagnostic sample alone.
fn measured_distance(old: &[C], new: &[C]) -> f64 {
    let Some(i) = (0..old.len()).find(|&i| old[i][0] != new[i][0]) else {
        return 0.;
    };
    if !unchanged_others(new, old, i) {
        return f64::INFINITY;
    }
    let prev = (i + old.len() - 1) % old.len();
    // All other boundary points have an identical counterpart (distance zero).
    // Matching against just the two changed arms gives a conservative upper
    // bound on full-boundary distance, at a fraction of the diagnostic cost.
    let a = crate::planar::flatten(&G::Beziers(vec![old[prev], old[i]]));
    let b = crate::planar::flatten(&G::Beziers(vec![new[prev], new[i]]));
    let mut max = 0f64;
    let mut work = 0;
    for (from, to) in [(&a, &b), (&b, &a)] {
        for w in from.windows(2) {
            let n = (dist(w[0], w[1]) / 0.5).ceil().max(1.) as usize;
            for j in 0..=n {
                let q = add(w[0], mul(sub(w[1], w[0]), j as f64 / n as f64));
                let mut best = f64::INFINITY;
                for e in to.windows(2) {
                    work += 1;
                    if work > 2_000_000 {
                        return f64::INFINITY;
                    }
                    let d = sub(e[1], e[0]);
                    let t = (dot(sub(q, e[0]), d) / dot(d, d).max(1e-20)).clamp(0., 1.);
                    best = best.min(dist(q, add(e[0], mul(d, t))));
                }
                max = max.max(best);
            }
        }
    }
    max
}
pub(crate) fn refine(old: &[C], img: &ColorImage, matte: &Matte) -> Option<Certified> {
    runtime_scope!(9);
    let started = now();
    let i = (0..old.len())
        .filter(|&i| {
            if turn(old, i) <= 0.65 {
                return false;
            }
            let a = arm_samples(old, i, true, 3., 10.);
            let b = arm_samples(old, i, false, 3., 10.);
            a.last().zip(b.last()).is_some_and(|((a, _), (b, _))| {
                dot(unit(sub(old[i][0], *a)), unit(sub(*b, old[i][0]))) < -0.8
            })
        })
        .max_by(|&a, &b| turn(old, a).total_cmp(&turn(old, b)))?;
    let origin = old[i][0];
    let prev = (i + old.len() - 1) % old.len();
    let depth = unit(sub(
        unit(sub(old[i][3], origin)),
        unit(sub(origin, old[prev][0])),
    ));
    let side = p(-depth.y, depth.x);
    let mut models = vec![];
    for radius in [16., 20., 28.] {
        let mut rejected = [-1.; 48];
        rejected[0] = 10.;
        rejected[1] = i as f64;
        rejected[2] = origin.x;
        rejected[3] = origin.y;
        rejected[24] = now() - started;
        rejected[43] = radius;
        let Some(a) = arm(old, i, true, origin, depth, side, radius, img, matte) else {
            rejected[40] = 7.;
            record(rejected);
            return None;
        };
        let Some(b) = arm(old, i, false, origin, depth, side, radius, img, matte) else {
            rejected[40] = 8.;
            record(rejected);
            return None;
        };
        let Some(h) = hypothesis(&a, &b, origin, depth, side) else {
            rejected[40] = 9.;
            record(rejected);
            return None;
        };
        models.push((a, b, h));
    }
    let mut row = [-1.; 48];
    row[0] = 10.;
    row[1] = i as f64;
    row[2] = origin.x;
    row[3] = origin.y;
    row[24] = now() - started;
    if !supported(&models, origin) {
        row[40] = 1.;
        record(row);
        return None;
    }
    let (a, b, h) = models
        .iter()
        .min_by(|a, b| a.2.uncertainty.total_cmp(&b.2.uncertainty))?;
    // Evidence-limited envelope, not a universal enlarged radius. The existing
    // hypothesis builder's 6px numerical cap is insufficient for certification.
    let delta = dist(h.q, origin);
    let limit = delta + 2. * h.uncertainty + 0.254;
    if limit > 0.4 * (a.max - a.min).min(b.max - b.min) {
        row[40] = 2.;
        record(row);
        return None;
    }
    row[4] = h.q.x;
    row[5] = h.q.y;
    row[6] = h.condition;
    row[7] = h.uncertainty;
    row[8] = delta;
    row[9] = limit;
    row[10] = a.support as f64;
    row[11] = b.support as f64;
    row[12] = a.min;
    row[13] = a.max;
    row[14] = b.min;
    row[15] = b.max;
    row[16] = a.rms;
    row[17] = b.rms;
    row[18] = models
        .iter()
        .map(|(_, _, other)| dist(h.q, other.q))
        .fold(0f64, f64::max);
    row[19] = dot(sub(h.q, origin), depth);
    row[35] = matte.linear as u8 as f64;
    row[36] = matte
        .a
        .iter()
        .zip(matte.b)
        .map(|(a, b)| (a - b).powi(2))
        .sum::<f64>();
    let tip = matte.patch(img, h.q, 3);
    if tip.len() != 49 {
        row[40] = 3.;
        record(row);
        return None;
    }
    let initial = propose(
        old,
        i,
        h.q,
        h.u,
        h.v,
        [
            dist(old[prev][0], old[prev][1]),
            dist(old[prev][0], h.q) / 3.,
            dist(old[i][3], h.q) / 3.,
            dist(old[i][2], old[i][3]),
        ],
    );
    let patch = pixel_patch(old, &initial, i, img, matte)?;
    let cache = Patch::new(old, &[prev, i], &patch, img, matte)?;
    let before = cache.score(old);
    let solving = now();
    runtime_count!(30, 1);
    let candidate = joint_handles(old, i, h, &cache)?;
    row[25] = now() - solving;
    row[0] = 20.;
    let after = cache.score(&candidate);
    row[20] = before.0;
    row[21] = after.0;
    row[22] = before.1;
    row[23] = after.1;
    row[30] = source_safe(&candidate, old, img) as u8 as f64;
    let Some((mass, ta, tb, peak)) = tip_support(old, &candidate, &tip) else {
        row[40] = 4.;
        record(row);
        return None;
    };
    row[42] = tip_support(old, &candidate, &patch).is_some() as u8 as f64;
    if row[42] != 1. {
        row[40] = 6.;
        record(row);
        return None;
    }
    row[26] = mass as f64;
    row[27] = ta;
    row[28] = tb;
    row[29] = peak;
    let proof = Certified {
        geometry: candidate,
        original: old.to_vec(),
        index: i,
        limit,
    };
    let safety = now();
    row[31] = proof.validate(&proof.geometry, old, img) as u8 as f64;
    row[32] = self_clear(&proof.geometry) as u8 as f64;
    row[33] = measured_distance(old, &proof.geometry);
    row[34] = now() - safety;
    if after.0 >= before.0 * 0.8
        || after.1 >= before.1
        || row[31] != 1.
        || row[32] != 1.
        || !row[33].is_finite()
    {
        row[40] = 5.;
        record(row);
        return None;
    }
    row[0] = 30.;
    row[40] = 0.;
    row[41] = now() - started;
    record(row);
    Some(proof)
}
pub(crate) fn committed(
    legacy: bool,
    new: &[C],
    old: &[C],
    elapsed: f64,
    before: (f64, f64),
    after: (f64, f64),
) {
    let mut row = [-1.; 48];
    row[0] = 40.;
    row[20] = before.0;
    row[21] = after.0;
    row[22] = before.1;
    row[23] = after.1;
    row[30] = legacy as u8 as f64;
    row[31] = 1.;
    row[32] = self_clear(new) as u8 as f64;
    row[33] = measured_distance(old, new);
    row[34] = elapsed;
    record(row);
}
#[cfg(test)]
mod tests {
    use super::*;
    fn models() -> Vec<(Arm, Arm, Hypothesis)> {
        (0..3)
            .map(|_| {
                let arm = || Arm {
                    coeff: [0.; 3],
                    scale: 28.,
                    rms: 0.004,
                    support: 20,
                    min: 5.,
                    max: 22.,
                };
                (
                    arm(),
                    arm(),
                    Hypothesis {
                        q: p(10., 5.),
                        u: unit(p(-0.07, -1.)),
                        v: unit(p(0.07, 1.)),
                        uncertainty: 0.1,
                        condition: 200.,
                        line: None,
                    },
                )
            })
            .collect()
    }
    #[test]
    fn certification_requires_independent_scales_support_and_conditioning() {
        let origin = p(10., 10.);
        assert!(supported(&models(), origin));
        assert!(!supported(&models()[..2], origin));
        let mut m = models();
        m[2].2.q.x += 0.3;
        assert!(!supported(&m, origin));
        let mut m = models();
        m[1].2.condition = 2000.;
        assert!(!supported(&m, origin));
        let mut m = models();
        m[0].0.support = 3;
        assert!(!supported(&m, origin));
        let mut m = models();
        m[0].2.uncertainty = 0.8;
        assert!(!supported(&m, origin));
    }
    #[test]
    fn missing_tip_pixels_are_positive_evidence_but_contradictory_background_blocks() {
        let line = |a: P, b: P| {
            [
                a,
                add(a, mul(sub(b, a), 1. / 3.)),
                add(a, mul(sub(b, a), 2. / 3.)),
                b,
            ]
        };
        let triangle = |q: P| {
            vec![
                line(q, p(20., 22.)),
                line(p(20., 22.), p(12., 22.)),
                line(p(12., 22.), q),
            ]
        };
        let (old, new) = (triangle(p(16., 8.)), triangle(p(16., 3.)));
        let mut ss: Vec<_> = (0..13)
            .flat_map(|y| {
                (10..23).map(move |x| Sample {
                    x,
                    y,
                    coverage: 0.,
                    trusted: true,
                })
            })
            .collect();
        let cov = coverage(&new, &ss).unwrap();
        for (s, c) in ss.iter_mut().zip(cov) {
            s.coverage = c;
        }
        assert!(tip_support(&old, &new, &ss).is_some());
        let a = coverage(&old, &ss).unwrap();
        let k = ss
            .iter()
            .zip(a)
            .position(|(s, a)| s.coverage > 0.1 && a < 0.01)
            .unwrap();
        ss[k].coverage = 0.;
        assert!(tip_support(&old, &new, &ss).is_none());
    }
    #[test]
    fn certificate_never_covers_a_new_baseline_or_unrelated_movement() {
        let old = vec![[p(1., 1.); 4], [p(2., 2.); 4], [p(3., 3.); 4]];
        let mut modified = old.clone();
        modified[1][1].x += 0.1;
        assert!(!unchanged_others(&modified, &old, 0));
        assert!(unchanged_others(&old, &old, 0));
        reset();
        for _ in 0..100 {
            record([-1.; 48]);
        }
        assert_eq!(evidence().len(), 3072);
        reset();
        assert!(evidence().is_empty());
    }
}
