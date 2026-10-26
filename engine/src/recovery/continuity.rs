//! Source-verified repair of short, inverted spline splices on final knots.
//! A raster column is an integral measurement, not an independently inverted
//! half-plane near a corner. No reference SVG or segmentation is an input.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u8)]
enum Class {
    TrueHardCorner,
    SmoothJoin,
    FalseCorner,
    JunctionLocked,
    Uncertain,
}
// Header: attempted pairs, accepted pairs, milliseconds. Each subsequent row:
// x,y,class,turn,protected confidence,reason,MSE before/after,RGB before/after,
// model RMS,model max,scale disagreement,span,pair side,reserved.
thread_local! {static RECORDS:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};static HEADER:RefCell<[f64;3]>=const{RefCell::new([0.;3])};}
pub(super) fn reset() {
    RECORDS.with(|r| r.borrow_mut().clear());
    HEADER.with(|r| *r.borrow_mut() = [0.; 3]);
}
pub(super) fn evidence() -> Vec<f64> {
    let mut result = HEADER.with(|h| h.borrow().to_vec());
    RECORDS.with(|r| result.extend(r.borrow().iter().copied()));
    result
}
fn note(row: [f64; 16]) {
    RECORDS.with(|r| {
        let mut r = r.borrow_mut();
        if r.len() < 4096 {
            r.extend(row);
        }
    });
}

fn confidence(q: P, evidence: &[f64]) -> f64 {
    evidence
        .chunks_exact(7)
        .filter(|r| r[6] > 0. && dist(q, p(r[4], r[5])) < 0.25)
        .map(|r| r[3])
        .fold(0., f64::max)
}
fn locked(cs: &[C], i: usize, evidence: &[f64]) -> Class {
    let angle = turn(cs, i);
    if angle < 0.15 {
        Class::SmoothJoin
    } else if angle > 0.65 && confidence(cs[i][0], evidence) >= 0.75 {
        Class::TrueHardCorner
    } else {
        Class::Uncertain
    }
}

#[derive(Clone)]
struct Graph {
    axis: usize,
    origin: f64,
    scale: f64,
    coeff: [f64; 5],
    rms: f64,
    max: f64,
    disagreement: f64,
    patch: Vec<Sample>,
}
fn coord(q: P, axis: usize) -> f64 {
    if axis == 0 { q.x } else { q.y }
}
fn point(x: f64, y: f64, axis: usize) -> P {
    if axis == 0 { p(x, y) } else { p(y, x) }
}
fn basis(a: f64, b: f64) -> [f64; 5] {
    // Exact column average of each polynomial basis, stable at small widths.
    std::array::from_fn(|k| {
        (0..=k)
            .map(|j| a.powi(j as i32) * b.powi((k - j) as i32))
            .sum::<f64>()
            / (k + 1) as f64
    })
}
fn fit(samples: &[([f64; 5], f64)]) -> Option<[f64; 5]> {
    let mut matrix = vec![vec![0.; 6]; 5];
    for (row, value) in samples {
        for i in 0..5 {
            matrix[i][5] += row[i] * value;
            for j in 0..5 {
                matrix[i][j] += row[i] * row[j];
            }
        }
    }
    let result = solve_banded(matrix, 4)?;
    Some(std::array::from_fn(|i| result[i]))
}
impl Graph {
    fn at(&self, x: f64) -> f64 {
        let t = (x - self.origin) / self.scale;
        self.coeff.iter().rev().fold(0., |s, c| s * t + c)
    }
    fn slope(&self, x: f64) -> f64 {
        let t = (x - self.origin) / self.scale;
        (1..5)
            .rev()
            .fold(0., |s, k| s * t + k as f64 * self.coeff[k])
            / self.scale
    }
    fn from(cs: &[C], i: usize, img: &ColorImage, matte: &Matte) -> Option<Self> {
        let n = cs.len();
        let prev = (i + n - 1) % n;
        let next = (i + 1) % n;
        let a = cs[prev][0];
        let b = cs[next][3];
        let axis = usize::from((b.y - a.y).abs() > (b.x - a.x).abs());
        let span = (coord(b, axis) - coord(a, axis)).abs();
        if !(7. ..=24.).contains(&span) {
            return None;
        }
        let origin = (coord(cs[i][0], axis) + coord(cs[i][3], axis)) * 0.5;
        let scale = span * 0.5;
        let controls: Vec<_> = [prev, i, next].into_iter().flat_map(|k| cs[k]).collect();
        // One monotone graph in the chosen pixel axis. Do not cross a thin
        // feature's opposite boundary to obtain more source support.
        let lo = controls
            .iter()
            .map(|q| coord(*q, 1 - axis))
            .fold(f64::INFINITY, f64::min)
            .floor() as i32
            - 2;
        let hi = controls
            .iter()
            .map(|q| coord(*q, 1 - axis))
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil() as i32
            + 2;
        let x0 = coord(a, axis).min(coord(b, axis)).ceil() as i32;
        let x1 = coord(a, axis).max(coord(b, axis)).floor() as i32;
        if hi - lo > 32 || x1 - x0 < 9 {
            return None;
        }
        let mut patch = vec![];
        let mut samples = vec![];
        let mut inside_below = None;
        for x in x0..x1 {
            let mut column = vec![];
            for y in lo..hi {
                let (xx, yy) = if axis == 0 { (x, y) } else { (y, x) };
                column.push(matte.sample(img, xx, yy)?);
            }
            let first = column.first()?.coverage;
            let last = column.last()?.coverage;
            let below = first < 0.02 && last > 0.98;
            if !below && !(first > 0.98 && last < 0.02) {
                return None;
            }
            if inside_below.is_some_and(|b| b != below)
                || column.windows(2).any(|s| {
                    let delta = s[1].coverage - s[0].coverage;
                    if below { delta < -0.03 } else { delta > 0.03 }
                })
            {
                return None;
            }
            inside_below = Some(below);
            let sum = column.iter().map(|s| s.coverage).sum::<f64>();
            let value = if below {
                hi as f64 - sum
            } else {
                lo as f64 + sum
            };
            let row = basis(
                (x as f64 - origin) / scale,
                (x as f64 + 1. - origin) / scale,
            );
            samples.push((row, value));
            patch.extend(column);
        }
        let coeff = fit(&samples)?;
        let residual: Vec<_> = samples
            .iter()
            .map(|(r, y)| y - r.iter().zip(coeff).map(|(a, b)| a * b).sum::<f64>())
            .collect();
        let rms = (residual.iter().map(|v| v * v).sum::<f64>() / residual.len() as f64).sqrt();
        let max = residual.iter().map(|v| v.abs()).fold(0., f64::max);
        if rms > 0.08 || max > 0.18 || coeff.iter().any(|v| !v.is_finite()) {
            return None;
        }
        let mut model = Self {
            axis,
            origin,
            scale,
            coeff,
            rms,
            max,
            disagreement: 0.,
            patch,
        };
        // The central and complete source windows must support the same
        // position/tangent. A low whole-window average alone is insufficient.
        if samples.len() < 11 {
            return None;
        }
        let small = fit(&samples[1..samples.len() - 1])?;
        let mut other = model.clone();
        other.coeff = small;
        model.disagreement = (model.at(origin) - other.at(origin)).abs()
            + (model.slope(origin) - other.slope(origin)).abs() * 2.;
        if model.disagreement > 0.08 {
            return None;
        }
        Some(model)
    }
    fn curves(&self, cs: &[C], i: usize) -> Option<[C; 2]> {
        let n = cs.len();
        let prev = (i + n - 1) % n;
        let next = (i + 1) % n;
        let a = cs[prev][0];
        let b = cs[next][3];
        let q = point(self.origin, self.at(self.origin), self.axis);
        if dist(q, cs[i][0]).max(dist(q, cs[i][3])) > 2. {
            return None;
        }
        let (u, _) = crate::inverse::endpoint_tangents(&cs[prev]);
        let (_, v) = crate::inverse::endpoint_tangents(&cs[next]);
        let dx = (coord(q, self.axis) - coord(a, self.axis)) / 3.;
        let dy = (coord(b, self.axis) - coord(q, self.axis)) / 3.;
        if dx * coord(u, self.axis) <= 1e-6 || dy * coord(v, self.axis) <= 1e-6 {
            return None;
        }
        let tangent = point(1., self.slope(self.origin), self.axis);
        Some([
            [
                a,
                add(a, mul(u, dx / coord(u, self.axis))),
                sub(q, mul(tangent, dx)),
                q,
            ],
            [
                q,
                add(q, mul(tangent, dy)),
                sub(b, mul(v, dy / coord(v, self.axis))),
                b,
            ],
        ])
    }
}

fn replacement(cs: &[C], i: usize, curves: [C; 2]) -> Vec<C> {
    let mut result = cs.to_vec();
    let n = cs.len();
    result[(i + n - 1) % n] = curves[0];
    result[i] = curves[1];
    result.remove((i + 1) % n);
    result
}
fn graph_safe(curves: &[C; 2], axis: usize) -> bool {
    let direction = (coord(curves[1][3], axis) - coord(curves[0][0], axis)).signum();
    curves.iter().all(|c| {
        c.windows(2)
            .all(|p| direction * (coord(p[1], axis) - coord(p[0], axis)) > 1e-6)
    }) && turn(curves, 1) < 1e-3
}
pub(super) fn refine(cs: &mut Vec<C>, img: &ColorImage, matte: &Matte) -> bool {
    runtime_scope!(6);
    let started = now();
    if cs.len() < 3
        || cs.len() > 128
        || cs
            .iter()
            .flatten()
            .any(|q| !q.x.is_finite() || !q.y.is_finite())
    {
        return false;
    }
    // Open boundaries/junction chains never enter a per-face continuity fit.
    if cs
        .iter()
        .enumerate()
        .any(|(i, c)| dist(c[3], cs[(i + 1) % cs.len()][0]) > 1e-8)
    {
        for q in [cs[0][0], cs[cs.len() - 1][3]] {
            note([
                q.x,
                q.y,
                Class::JunctionLocked as u8 as f64,
                0.,
                1.,
                20.,
                0.,
                0.,
                0.,
                0.,
                0.,
                0.,
                0.,
                0.,
                0.,
                0.,
            ]);
        }
        return false;
    }
    let before_all = cs.clone();
    let protected = crate::corners::evidence();
    let mut attempted = HashSet::new();
    let mut accepted = 0;
    let mut attempts = 0;
    while attempts < 8 && accepted < 4 {
        let n = cs.len();
        let pair = (0..n).find(|&i| {
            let c = cs[i];
            length(&c) < 4.
                && !curve_line(&c)
                && turn(cs, i) > 0.65
                && turn(cs, (i + 1) % n) > 0.65
                && length(&cs[(i + n - 1) % n]) > 4.
                && length(&cs[(i + 1) % n]) > 4.
                && !attempted.contains(&(c[0].x.to_bits(), c[0].y.to_bits()))
        });
        let Some(i) = pair else { break };
        let prev = (i + n - 1) % n;
        let next = (i + 1) % n;
        let a = cs[i][0];
        let b = cs[next][0];
        attempted.insert((a.x.to_bits(), a.y.to_bits()));
        attempts += 1;
        let ca = confidence(a, &protected);
        let cb = confidence(b, &protected);
        let mut row = [
            a.x,
            a.y,
            Class::Uncertain as u8 as f64,
            turn(cs, i),
            ca,
            1.,
            0.,
            0.,
            0.,
            0.,
            0.,
            0.,
            0.,
            length(&cs[i]),
            0.,
            0.,
        ];
        if ca == 0. || cb == 0. || ca >= 0.75 || cb >= 0.75 {
            row[2] = if ca >= 0.75 {
                Class::TrueHardCorner as u8 as f64
            } else {
                Class::Uncertain as u8 as f64
            };
            note(row);
            continue;
        }
        let Some(model) = Graph::from(cs, i, img, matte) else {
            row[5] = 2.;
            note(row);
            continue;
        };
        row[10] = model.rms;
        row[11] = model.max;
        row[12] = model.disagreement;
        let Some(mut curves) = model.curves(cs, i) else {
            row[5] = 3.;
            note(row);
            continue;
        };
        round(&mut curves);
        if !graph_safe(&curves, model.axis) {
            row[5] = 3.;
            note(row);
            continue;
        }
        let Some(cache) = Patch::new(cs, &[prev, i, next], &model.patch, img, matte) else {
            continue;
        };
        let before = cache.score(cs);
        let after = cache.score_changed(&curves);
        row[6] = before.0;
        row[7] = after.0;
        row[8] = before.1;
        row[9] = after.1;
        let mut trial = replacement(cs, i, curves);
        round(&mut trial);
        if after.0 < before.0 * 0.85
            && after.1 < before.1
            && self_clear(&trial)
            && source_safe(&trial, &before_all, img)
        {
            *cs = trial;
            row[2] = Class::FalseCorner as u8 as f64;
            row[5] = 0.;
            accepted += 1;
        } else {
            row[5] = 4.;
        }
        note(row);
        row[0] = b.x;
        row[1] = b.y;
        row[4] = cb;
        row[14] = 1.;
        note(row);
    }
    for i in 0..cs.len() {
        let q = cs[i][0];
        note([
            q.x,
            q.y,
            locked(cs, i, &protected) as u8 as f64,
            turn(cs, i),
            confidence(q, &protected),
            10.,
            0.,
            0.,
            0.,
            0.,
            0.,
            0.,
            0.,
            length(&cs[i]),
            0.,
            0.,
        ]);
    }
    HEADER.with(|h| {
        let mut h = h.borrow_mut();
        h[0] += attempts as f64;
        h[1] += accepted as f64;
        h[2] += now() - started;
    });
    count(30, accepted as f64);
    count(31, now() - started);
    accepted > 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn integrated_polynomial_basis_is_not_a_pixel_center_sample() {
        let r = basis(-0.25, 0.25);
        assert_eq!(r[0], 1.);
        assert!(r[1].abs() < 1e-12);
        assert!((r[2] - 1. / 48.).abs() < 1e-12);
        assert!(r[2] > 0.);
    }
    #[test]
    fn integrated_fit_recovers_an_asymmetric_polynomial() {
        let expected = [9.2, 0.7, 3.1, -0.6, 0.4];
        let samples: Vec<_> = (0..14)
            .map(|i| {
                let b = basis(i as f64 / 7. - 1., (i + 1) as f64 / 7. - 1.);
                (b, b.iter().zip(expected).map(|(a, b)| a * b).sum())
            })
            .collect();
        let c = fit(&samples).unwrap();
        for (a, b) in c.into_iter().zip(expected) {
            assert!((a - b).abs() < 1e-9);
        }
    }
    #[test]
    fn diagnostics_are_bounded_and_reset() {
        reset();
        for _ in 0..400 {
            note([0.; 16]);
        }
        assert_eq!(evidence().len(), 4099);
        reset();
        assert_eq!(evidence(), vec![0.; 3]);
        assert_ne!(Class::JunctionLocked, Class::FalseCorner);
    }
    fn source(function: impl Fn(f64) -> f64, axis: usize) -> (ColorImage, Matte) {
        let a = [36u8, 90, 183];
        let mut pixels = vec![255u8; 48 * 48 * 4];
        // Independent horizontal quadrature of a known graph, not the engine's
        // polygon coverage evaluator or a reference given to the optimizer.
        for x in 0..48 {
            for y in 0..48 {
                let coverage = (0..128)
                    .map(|k| {
                        (y as f64 + 1. - function(x as f64 + (k as f64 + 0.5) / 128.)).clamp(0., 1.)
                    })
                    .sum::<f64>()
                    / 128.;
                let (xx, yy) = if axis == 0 { (x, y) } else { (y, x) };
                for k in 0..3 {
                    pixels[(yy * 48 + xx) * 4 + k] =
                        (255. + coverage * (a[k] as f64 - 255.)).round() as u8;
                }
            }
        }
        let a = a.map(|v| v as f64 / 255.);
        (
            ColorImage {
                width: 48,
                height: 48,
                pixels,
            },
            Matte {
                a,
                b: [1.; 3],
                linear: false,
                render_a: a,
                render_b: [1.; 3],
            },
        )
    }
    fn fake_splice(axis: usize) -> Vec<C> {
        let p = |x, y| point(x, y, axis);
        vec![
            [p(13., 25.), p(15., 22.), p(17., 22.), p(18.98, 18.97)],
            [
                p(18.98, 18.97),
                p(19.19, 20.61),
                p(20.81, 20.61),
                p(21.02, 18.97),
            ],
            [p(21.02, 18.97), p(23., 22.), p(25., 22.), p(27., 25.)],
        ]
    }
    #[test]
    fn a_source_supported_asymmetric_curve_has_a_smooth_two_cubic_hypothesis() {
        for axis in [0, 1] {
            let (img, matte) = source(
                |x| {
                    let t = x - 20.;
                    20. + 0.1 * t * t + 0.002 * t * t * t
                },
                axis,
            );
            let cs = fake_splice(axis);
            let model = Graph::from(&cs, 1, &img, &matte).unwrap();
            assert!(model.rms < 0.02);
            assert!((model.at(20.) - 20.).abs() < 0.02);
            assert!(model.coeff[3].abs() > 0.1, "asymmetry must be retained");
            let c = model.curves(&cs, 1).unwrap();
            assert!(graph_safe(&c, axis));
            assert_eq!(c[0][0], cs[0][0]);
            assert_eq!(c[1][3], cs[2][3]);
            assert!(turn(&c, 1) < 1e-6);
        }
    }
    #[test]
    fn a_true_v_cannot_be_certified_by_a_smooth_source_model() {
        let (img, matte) = source(|x| 20. + (x - 20.).abs(), 0);
        assert!(Graph::from(&fake_splice(0), 1, &img, &matte).is_none());
    }
    #[test]
    fn partial_alpha_and_a_second_boundary_are_not_column_coverage() {
        let (mut img, matte) = source(|x| 20. + 0.1 * (x - 20.).powi(2), 0);
        img.pixels[(20 * 48 + 20) * 4 + 3] = 128;
        assert!(Graph::from(&fake_splice(0), 1, &img, &matte).is_none());
        let (mut img, matte) = source(|x| 20. + 0.1 * (x - 20.).powi(2), 0);
        for y in 26..48 {
            for x in 0..48 {
                for k in 0..3 {
                    img.pixels[(y * 48 + x) * 4 + k] = 255;
                }
            }
        }
        assert!(Graph::from(&fake_splice(0), 1, &img, &matte).is_none());
    }
    #[test]
    fn open_chains_are_locked_and_degenerate_input_does_not_panic() {
        reset();
        let (img, matte) = source(|x| 20. + 0.1 * (x - 20.).powi(2), 0);
        let mut open = fake_splice(0);
        let old = open.clone();
        assert!(!refine(&mut open, &img, &matte));
        assert_eq!(open, old);
        assert_eq!(evidence()[5], Class::JunctionLocked as u8 as f64);
        assert!(!refine(&mut vec![], &img, &matte));
        open[0][0].x = f64::NAN;
        assert!(!refine(&mut open, &img, &matte));
        reset();
    }
    #[test]
    fn strong_protected_final_turns_and_unsupported_turns_remain_locked() {
        let cs = fake_splice(0);
        let q = cs[1][0];
        assert_eq!(locked(&cs, 1, &[]), Class::Uncertain);
        assert_eq!(
            locked(&cs, 1, &[0., 0., 0., 1., q.x, q.y, 1.]),
            Class::TrueHardCorner
        );
    }
}
