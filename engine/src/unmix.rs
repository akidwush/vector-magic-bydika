//! Two-colour evidence only. All model residuals are measured in encoded RGB.
use crate::alpha::{linear_to_srgb, srgb_to_linear};
pub fn project(c: [f64; 3], a: [f64; 3], b: [f64; 3], linear: bool) -> Option<(f64, f64)> {
    if c.into_iter()
        .chain(a)
        .chain(b)
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
    {
        return None;
    }
    let convert = |x: [f64; 3]| if linear { x.map(srgb_to_linear) } else { x };
    let (p, u, v) = (convert(c), convert(a), convert(b));
    let d = std::array::from_fn::<_, 3, _>(|k| u[k] - v[k]);
    let norm = d.iter().map(|x| x * x).sum::<f64>();
    if norm < 1e-6 {
        return None;
    }
    let t = (0..3).map(|k| (p[k] - v[k]) * d[k]).sum::<f64>() / norm;
    if !(-0.08..=1.08).contains(&t) {
        return None;
    }
    let t = t.clamp(0., 1.);
    let error = (0..3)
        .map(|k| {
            let x = v[k] + t * d[k];
            let predicted = if linear { linear_to_srgb(x) } else { x };
            (predicted - c[k]).powi(2)
        })
        .sum::<f64>();
    Some((t, error))
}
/// None means ambiguous, never evidence for stripping a third region.
pub fn select(cs: &[[f64; 3]], a: [f64; 3], b: [f64; 3]) -> Option<bool> {
    let mut errors = [0.; 2];
    let mut count = 0;
    for &c in cs {
        let (s, l) = (project(c, a, b, false)?, project(c, a, b, true)?);
        if s.0 > 0.02 && s.0 < 0.98 && l.0 > 0.02 && l.0 < 0.98 {
            errors[0] += s.1;
            errors[1] += l.1;
            count += 1;
        }
    }
    if count < 8 {
        return None;
    }
    let [s, l] = errors.map(|x| x / count as f64);
    // Common encoded quantization floor and a relative evidence margin.
    if s.min(l) > 3.0 / (255.0 * 255.0) || (s - l).abs() < 3.0 / (255.0 * 255.0) {
        return None;
    }
    if l < s * 0.5 {
        Some(true)
    } else if s < l * 0.5 {
        Some(false)
    } else {
        None
    }
}
/// Signed offset of n·(x-centre)<=d (foreground A). Normal may be unnormalised.
/// Thus the boundary point is centre + d*n_unit, not centre - d*n_unit.
#[allow(dead_code)] // Analytically tested; anchor movement requires a separate geometric promotion gate.
pub fn offset(coverage: f64, nx: f64, ny: f64) -> Option<f64> {
    let norm = nx.hypot(ny);
    if !norm.is_finite()
        || norm < 1e-12
        || !coverage.is_finite()
        || !(0.0..=1.0).contains(&coverage)
    {
        return None;
    }
    let u = nx.abs().min(ny.abs()) / norm;
    let v = nx.abs().max(ny.abs()) / norm;
    let a = coverage.min(1. - coverage);
    let magnitude = if u < 1e-12 || a >= 0.5 * u / v {
        (0.5 - a) * v
    } else {
        0.5 * (u + v) - (2. * a * u * v).sqrt()
    };
    Some(if coverage < 0.5 {
        -magnitude
    } else {
        magnitude
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_gamma_models_and_ambiguity() {
        let a = [0.85, 0.12, 0.3];
        let b = [0.1, 0.8, 0.95];
        for linear in [false, true] {
            let colors: Vec<_> = (1..20)
                .map(|i| {
                    let t = i as f64 / 20.;
                    std::array::from_fn(|k| {
                        if linear {
                            linear_to_srgb(
                                t * srgb_to_linear(a[k]) + (1. - t) * srgb_to_linear(b[k]),
                            )
                        } else {
                            t * a[k] + (1. - t) * b[k]
                        }
                    })
                })
                .collect();
            assert_eq!(select(&colors, a, b), Some(linear));
            for (i, c) in colors.iter().enumerate() {
                assert!(
                    (project(*c, a, b, linear).unwrap().0 - (i + 1) as f64 / 20.).abs() < 1e-12
                );
            }
        }
        assert_eq!(select(&vec![[0.5; 3]; 12], [1.; 3], [0.; 3]), None);
        assert!(project([f64::NAN; 3], a, b, false).is_none());
    }
    #[test]
    fn offset_matches_independent_polygon_clipping_all_orientations() {
        let mut worst: f64 = 0.;
        for angle in 0..360 {
            let theta = angle as f64 * std::f64::consts::PI / 180.;
            let (nx, ny) = (theta.cos(), theta.sin());
            for alpha in [
                0.,
                0.001,
                1. / 64.,
                0.1,
                0.25,
                0.5,
                0.75,
                0.9,
                63. / 64.,
                0.999,
                1.,
            ] {
                let d = offset(alpha, nx, ny).unwrap();
                let square = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)];
                let mut clipped = vec![];
                for i in 0..4 {
                    let a = square[i];
                    let b = square[(i + 1) % 4];
                    let fa = nx * a.0 + ny * a.1 - d;
                    let fb = nx * b.0 + ny * b.1 - d;
                    if fa <= 0. {
                        clipped.push(a);
                    }
                    if (fa <= 0.) != (fb <= 0.) {
                        let t = fa / (fa - fb);
                        clipped.push((a.0 + t * (b.0 - a.0), a.1 + t * (b.1 - a.1)));
                    }
                }
                let area = if clipped.len() < 3 {
                    0.
                } else {
                    (0..clipped.len())
                        .map(|i| {
                            let a = clipped[i];
                            let b = clipped[(i + 1) % clipped.len()];
                            a.0 * b.1 - a.1 * b.0
                        })
                        .sum::<f64>()
                        .abs()
                        * 0.5
                };
                worst = worst.max((area - alpha).abs());
                assert!((area - alpha).abs() < 1e-12);
                assert!((offset(alpha, -nx, -ny).unwrap() - d).abs() < 1e-12);
            }
        }
        println!("OFFSET_PROOF 3960 orientation/coverage pairs worst_area_error={worst}");
    }
}
