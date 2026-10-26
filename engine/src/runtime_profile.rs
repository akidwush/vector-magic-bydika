//! Fixed-size diagnostic counters; inclusive timers nest and MUST NOT be summed.
use std::cell::RefCell;
const NAMES: [&str; 32] = [
    "rust_trace",
    "prepare",
    "node_reduce",
    "recovery",
    "inverse_fit",
    "source_fit",
    "continuity",
    "cap_initialize",
    "sharp_initialize",
    "large_recovery",
    "joint_handles",
    "legacy_safety",
    "self_clear",
    "patch_build",
    "patch_score",
    "flatten_001",
    "green_integral",
    "boundary_correspondence",
    "matte_score",
    "final_validation",
    "planar_flatten",
    "eligible_components",
    "rejected_components",
    "source_samples",
    "apex_hypotheses",
    "local_trials",
    "cache_hits",
    "cache_misses",
    "candidate_scores",
    "inverse_loss",
    "large_joint_solves",
    "region_fitter",
];
thread_local! {static DATA:RefCell<[f64;96]>=const{RefCell::new([0.;96])};}
pub fn reset() {
    DATA.with(|d| *d.borrow_mut() = [0.; 96]);
}
pub fn values() -> Vec<f64> {
    DATA.with(|d| d.borrow()[..64].to_vec())
}
pub fn names() -> String {
    NAMES.join("|")
}
pub fn count(i: usize, n: f64) {
    DATA.with(|d| d.borrow_mut()[i] += n);
}
#[cfg(target_arch = "wasm32")]
fn clock() -> f64 {
    crate::now()
}
#[cfg(not(target_arch = "wasm32"))]
fn clock() -> f64 {
    static ORIGIN: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    ORIGIN
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.
}
pub struct Scope {
    index: usize,
    start: f64,
}
impl Scope {
    pub fn new(index: usize) -> Self {
        count(index, 1.);
        Self {
            index,
            start: clock(),
        }
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        DATA.with(|d| d.borrow_mut()[32 + self.index] += clock() - self.start);
    }
}
// Counts and inclusive times; appended storage preserves the Stage G ABI.
const WORK_NAMES: [&str; 16] = [
    "loss",
    "clamp_calls",
    "clamp_heap_vectors",
    "area_samples",
    "row_edges",
    "flatten_curves",
    "flatten_points",
    "flat_hits",
    "flat_misses",
    "flat_points_peak",
    "samples_prepare",
    "candidate_fitter",
    "sample_rows",
    "clamp_constant",
    "loss_samples",
    "flat_fallback",
];
pub fn work_count(i: usize, n: f64) {
    DATA.with(|d| d.borrow_mut()[64 + i] += n);
}
#[cfg(feature = "inverse_hotpath")]
pub fn work_max(i: usize, n: f64) {
    DATA.with(|d| {
        let mut d = d.borrow_mut();
        d[64 + i] = d[64 + i].max(n);
    });
}
pub fn work_values() -> Vec<f64> {
    DATA.with(|d| d.borrow()[64..].to_vec())
}
pub fn work_names() -> String {
    WORK_NAMES.join("|")
}
pub struct WorkScope {
    index: usize,
    start: f64,
}
impl WorkScope {
    pub fn new(index: usize) -> Self {
        work_count(index, 1.);
        Self {
            index,
            start: clock(),
        }
    }
}
impl Drop for WorkScope {
    fn drop(&mut self) {
        DATA.with(|d| d.borrow_mut()[80 + self.index] += clock() - self.start);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nesting_counts_and_reset_are_per_trace() {
        reset();
        {
            let _a = Scope::new(0);
            {
                let _b = Scope::new(15);
            }
            count(25, 3.);
        }
        let d = values();
        assert_eq!(d[0], 1.);
        assert_eq!(d[15], 1.);
        assert_eq!(d[25], 3.);
        assert!(d[32] >= d[47]);
        reset();
        assert!(values().iter().all(|v| *v == 0.));
        assert!(work_values().iter().all(|v| *v == 0.));
        assert_eq!(work_names().split('|').count(), 16);
        assert_eq!(names().split('|').count(), 32);
    }
}
