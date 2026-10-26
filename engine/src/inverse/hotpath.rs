//! Source-exact computation reuse. No candidate or topology decision lives here.
use super::*;

/// Same breakpoints, sorting and summation expression as the legacy Vec. The
/// integrand has at most two clamp knots, so four stack cells are sufficient.
pub(super) fn clamped_integral(a: f64, b: f64, dy: f64) -> f64 {
    if (a - b).abs() < 1e-12 {
        return a.clamp(0., 1.) * dy;
    }
    let mut knots = [0., 1., 0., 0.];
    let mut n = 2;
    for boundary in [0., 1.] {
        let t = (boundary - a) / (b - a);
        if t > 0. && t < 1. {
            knots[n] = t;
            n += 1;
        }
    }
    knots[..n].sort_by(f64::total_cmp);
    knots[..n]
        .windows(2)
        .map(|w| {
            let value = |t: f64| (a + (b - a) * t).clamp(0., 1.);
            (w[1] - w[0]) * (value(w[0]) + value(w[1])) * 0.5 * dy
        })
        .sum()
}

/// Prepare per-row geometric constants once, while preserving the original
/// directed-edge ordering and every sample's accumulation order. Sample x is
/// subtracted AFTER the identical world-space endpoint expression is evaluated.
/// No per-cubic partial sums are formed (which would reassociate floating point).
pub(super) fn signed_edge_areas(poly: &[P], ss: &[Sample]) -> Option<Vec<f64>> {
    if poly.len() < 2
        || poly.len() > 32768
        || poly.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return None;
    }
    let mut rows: HashMap<i32, Vec<[f64; 4]>> = HashMap::new();
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
                let lo = a.y.min(b.y).max(y as f64);
                let hi = a.y.max(b.y).min(y as f64 + 1.);
                if hi <= lo {
                    continue;
                }
                let x = |y| a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
                row.push([x(lo), x(hi), hi - lo, (b.y - a.y).signum()]);
            }
        }
    }
    Some(
        ss.iter()
            .map(|s| {
                let mut area = 0.;
                for &[a, b, dy, sign] in &rows[&s.y] {
                    area += sign * super::clamped_integral(a - s.x as f64, b - s.x as f64, dy);
                }
                area
            })
            .collect(),
    )
}

type Key = ([u64; 8], u64);
struct Entry {
    key: Key,
    points: Box<[P]>,
}
const MAX_POINTS: usize = 32768; // 512 KiB of point data + <=128 slot metadata
/// One local handle-search lifetime, borrowing the exact immutable source set.
/// Not shared with recovery::Patch, across components, images, or Worker jobs.
/// Activated only at the known repeated single-handle search, with >=8 cubics.
/// Exact bits include signed zero, orientation, control order and tolerance.
pub(super) struct LocalLoss<'a> {
    ss: &'a [Sample],
    entries: Vec<Option<Entry>>,
    points: usize,
    disabled: bool,
}
impl<'a> LocalLoss<'a> {
    pub(super) fn new(ss: &'a [Sample]) -> Self {
        Self {
            ss,
            entries: Vec::new(),
            points: 0,
            disabled: false,
        }
    }
    fn flatten(&mut self, g: &G, tol: f64) -> Option<Vec<P>> {
        let G::Beziers(cs) = g else {
            return super::flatten(g, tol);
        };
        if self.disabled || cs.len() < 8 || cs.len() > 128 {
            inverse_count!(15, 1);
            return super::flatten(g, tol);
        }
        if cs.len() != self.entries.len() {
            self.entries = (0..cs.len()).map(|_| None).collect();
            self.points = 0;
        }
        let mut out = vec![cs.first()?[0]];
        for (i, c) in cs.iter().enumerate() {
            let key = (
                std::array::from_fn(|j| {
                    if j % 2 == 0 {
                        c[j / 2].x.to_bits()
                    } else {
                        c[j / 2].y.to_bits()
                    }
                }),
                tol.to_bits(),
            );
            if !self.entries[i].as_ref().is_some_and(|e| e.key == key) {
                inverse_count!(8, 1);
                let points = super::flatten(&G::Beziers(vec![*c]), tol)?;
                let previous = self.entries[i].as_ref().map_or(0, |e| e.points.len());
                if self.points - previous + points.len() > MAX_POINTS {
                    self.entries.clear();
                    self.points = 0;
                    self.disabled = true;
                    inverse_count!(15, 1);
                    return super::flatten(g, tol);
                }
                self.points = self.points - previous + points.len();
                self.entries[i] = Some(Entry {
                    key,
                    points: points.into_boxed_slice(),
                });
                #[cfg(feature = "runtime_profile")]
                crate::runtime_profile::work_max(9, self.points as f64);
            } else {
                inverse_count!(7, 1);
            }
            // Match split's global output cap, including its permitted final
            // 8193rd point and failure before any subsequent recursive call.
            if out.len() > 8192 {
                return None;
            }
            out.extend_from_slice(&self.entries[i].as_ref()?.points[1..]);
            if out.len() > 8193 {
                return None;
            }
        }
        Some(out)
    }
    pub(super) fn score(&mut self, g: &G, tol: f64) -> f64 {
        inverse_scope!(0);
        inverse_count!(14, self.ss.len());
        runtime_count!(29, 1);
        LAST.with(|s| s.borrow_mut().evaluations += 1);
        let Some(p) = self.flatten(g, tol) else {
            return f64::INFINITY;
        };
        let Some(values) = coverages(&p, self.ss) else {
            return f64::INFINITY;
        };
        super::coverage_loss(&values, self.ss)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> P {
        P { x, y }
    }
    #[test]
    fn clamp_stack_has_identical_bits_including_breakpoints_and_signed_zero() {
        let vs = [
            -1e10,
            -3.,
            -1.,
            -1e-12,
            -0.,
            0.,
            1e-12,
            0.03125,
            0.5,
            0.999999999999,
            1.,
            1.000000000001,
            2.,
            1e10,
        ];
        for a in vs {
            for b in vs {
                for dy in [0., 1e-8, 0.03125, 0.77, 1.] {
                    assert_eq!(
                        clamped_integral(a, b, dy).to_bits(),
                        super::super::clamped_integral_legacy(a, b, dy).to_bits(),
                        "{a} {b} {dy}"
                    );
                }
            }
        }
    }
    #[test]
    fn row_constants_preserve_each_sample_accumulation_and_winding() {
        let ss: Vec<_> = (-3..7)
            .flat_map(|y| {
                (-4..9).map(move |x| Sample {
                    trusted: true,
                    x,
                    y,
                    coverage: 0.37,
                })
            })
            .collect();
        let mut seed = 0x12345678_u64;
        for _ in 0..100 {
            let mut ps: Vec<_> = (0..24)
                .map(|_| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let x = (seed >> 32) as f64 / u32::MAX as f64 * 24. - 12.;
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    p(x, (seed >> 32) as f64 / u32::MAX as f64 * 24. - 12.)
                })
                .collect();
            ps.push(ps[0]);
            for _ in 0..2 {
                let a = signed_edge_areas(&ps, &ss).unwrap();
                let b = super::super::signed_edge_areas_legacy(&ps, &ss).unwrap();
                assert_eq!(
                    a.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
                    b.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
                );
                ps.reverse();
            }
        }
        for ps in [
            vec![p(0., 0.)],
            vec![p(f64::NAN, 0.), p(0., 0.)],
            vec![p(0., 0.), p(1., 4097.)],
        ] {
            assert!(signed_edge_areas(&ps, &ss).is_none());
        }
    }
    fn ring() -> G {
        G::Beziers(
            (0..12)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / 12.;
                    let b = (i + 1) as f64 * std::f64::consts::TAU / 12.;
                    let at = |t: f64| p(10. + 8. * t.cos(), 10. + 8. * t.sin());
                    [
                        at(a),
                        at(a + (b - a) / 3.),
                        at(a + 2. * (b - a) / 3.),
                        at(b),
                    ]
                })
                .collect(),
        )
    }
    #[test]
    fn reuse_matches_loss_bits_after_trials_rollback_tolerance_and_topology_changes() {
        let ss: Vec<_> = (0..20)
            .flat_map(|y| {
                (0..20).map(move |x| Sample {
                    trusted: true,
                    x,
                    y,
                    coverage: (x % 3) as f64 / 3.,
                })
            })
            .collect();
        let baseline = ring();
        let mut evaluator = LocalLoss::new(&ss);
        for j in 0..40 {
            let mut trial = baseline.clone();
            if let G::Beziers(ref mut cs) = trial {
                cs[j % 12][1].x += (j % 7) as f64 * 0.03;
            }
            for g in [&trial, &baseline] {
                for tol in [0.01, 0.001, 0.01] {
                    assert_eq!(
                        evaluator.score(g, tol).to_bits(),
                        super::super::loss(g, &ss, tol).to_bits()
                    );
                }
            }
        }
        if let G::Beziers(mut cs) = baseline.clone() {
            cs.pop();
            let shorter = G::Beziers(cs);
            assert_eq!(
                evaluator.score(&shorter, 0.01).to_bits(),
                super::super::loss(&shorter, &ss, 0.01).to_bits()
            );
        }
        // A separate source set cannot reuse another evaluator's scalar scores.
        let mut changed = ss.clone();
        changed[5].coverage = 0.123;
        assert_eq!(
            LocalLoss::new(&changed).score(&baseline, 0.01).to_bits(),
            super::super::loss(&baseline, &changed, 0.01).to_bits()
        );
        assert!(evaluator.points <= MAX_POINTS);
        evaluator.disabled = true;
        assert_eq!(
            evaluator.score(&baseline, 0.01).to_bits(),
            super::super::loss(&baseline, &ss, 0.01).to_bits()
        );
    }
    #[test]
    fn flatten_limits_and_degenerate_controls_match_legacy() {
        let ss = [];
        let mut evaluator = LocalLoss::new(&ss);
        for count in [0, 1, 7, 8, 128, 129] {
            let g = G::Beziers(vec![
                [p(0., 0.), p(0., 100.), p(100., -100.), p(100., 0.)];
                count
            ]);
            for tol in [0.001, 0.01, 1e-9] {
                let a = evaluator.flatten(&g, tol);
                let b = super::super::flatten(&g, tol);
                assert_eq!(a.is_some(), b.is_some());
                if let (Some(a), Some(b)) = (a, b) {
                    assert_eq!(a, b);
                }
            }
        }
    }
}
