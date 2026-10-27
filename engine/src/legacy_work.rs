//! Stage J diagnostic-only exact loop counters. No geometry or acceptance state.
use std::cell::RefCell;
const NAMES: [&str; 12] = [
    "region_masks",
    "mask_scan_pixels",
    "binary_components",
    "component_pixels",
    "round_test_pixels",
    "correspondence_queries",
    "correspondence_edge_tests",
    "source_model_candidates",
    "location_path_comparisons",
    "recovery_spans_ranked",
    "recovery_spans_solved",
    "inverse_axis_proposals",
];
thread_local! {static DATA:RefCell<[u64;12]>=const{RefCell::new([0;12])};}
pub fn count(i: usize, n: u64) {
    DATA.with(|d| d.borrow_mut()[i] += n);
}
pub fn reset() {
    DATA.with(|d| *d.borrow_mut() = [0; 12]);
    vtracer::runtime_work::reset();
}
pub fn names() -> String {
    format!("{}|{}", NAMES.join("|"), vtracer::runtime_work::names())
}
pub fn values() -> Vec<f64> {
    let mut v = DATA.with(|d| d.borrow().iter().map(|n| *n as f64).collect::<Vec<_>>());
    v.extend(
        vtracer::runtime_work::values()
            .into_iter()
            .map(|n| n as f64),
    );
    v
}
#[cfg(test)]
mod tests {
    #[test]
    fn reset_is_conversion_local() {
        super::reset();
        super::count(0, 3);
        vtracer::runtime_work::count(0, 7);
        assert_eq!(super::values()[0], 3.);
        assert_eq!(super::values()[12], 7.);
        super::reset();
        assert!(super::values().iter().all(|v| *v == 0.));
        assert_eq!(super::names().split('|').count(), super::values().len());
    }
}
