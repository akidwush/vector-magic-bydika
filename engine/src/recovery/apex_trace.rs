//! Bounded research diagnostics. -1 means not evaluated, never an implied PASS.
use super::*;
thread_local! {static ROWS:RefCell<Vec<f64>>=const{RefCell::new(Vec::new())};}
pub(super) fn reset() {
    ROWS.with(|r| r.borrow_mut().clear());
}
pub(super) fn values() -> Vec<f64> {
    ROWS.with(|r| r.borrow().clone())
}
pub(super) fn record(row: [f64; 32]) {
    ROWS.with(|r| {
        let mut r = r.borrow_mut();
        if r.len() < 8192 {
            r.extend(row)
        }
    });
}
pub(super) fn component(
    stage: f64,
    legacy: bool,
    old: &[C],
    new: &[C],
    elapsed: f64,
    scores: Option<((f64, f64), (f64, f64))>,
) {
    let mut r = [-1.; 32];
    r[0] = stage;
    r[2] = old[0][0].x;
    r[3] = old[0][0].y;
    r[4] = new[0][0].x;
    r[5] = new[0][0].y;
    r[27] = elapsed;
    if let Some((before, after)) = scores {
        r[11] = before.0;
        r[12] = after.0;
        r[13] = before.1;
        r[14] = after.1;
    }
    r[17] = (area(old) * area(new) > 0.) as u8 as f64;
    r[18] = new
        .iter()
        .enumerate()
        .all(|(i, c)| dist(c[3], new[(i + 1) % new.len()][0]) < 1e-8) as u8 as f64;
    if stage == 100. {
        r[16] = 0.;
    }
    if stage == 104. {
        r[16] = 1.;
        r[15] = 0.;
    }
    if stage >= 101. && stage != 104. {
        r[16] = 1.;
        r[15] = 1.;
    }
    if stage == 101. {
        r[19] = 0.;
    }
    if stage == 102. {
        r[19] = 1.;
        r[20] = 0.;
    }
    if stage == 103. || stage == 110. {
        r[19] = 1.;
        r[20] = 1.;
        r[21] = (stage == 110.) as u8 as f64;
    }
    r[16] = legacy as u8 as f64;
    record(r);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn evidence_is_bounded_reset_and_preserves_unevaluated_states() {
        reset();
        for _ in 0..300 {
            record([-1.; 32]);
        }
        assert_eq!(values().len(), 8192);
        assert!(values().iter().all(|v| *v == -1.));
        reset();
        assert!(values().is_empty());
    }
}
