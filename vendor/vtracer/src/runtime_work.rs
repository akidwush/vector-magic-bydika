//! Opt-in outer-work counts; private visioncortex internals are NOT inferred.
use std::cell::RefCell;
const NAMES: [&str; 7] = [
    "cluster_prepare_pixels",
    "cluster_tick_calls",
    "cluster_output_layers",
    "cluster_mask_bbox_pixels",
    "upstream_trace_region_calls",
    "upstream_binary_scan_pixels",
    "upstream_contour_components",
];
thread_local! {static DATA:RefCell<[u64;7]>=const{RefCell::new([0;7])};}
pub fn count(i: usize, n: u64) {
    DATA.with(|d| d.borrow_mut()[i] += n);
}
pub fn reset() {
    DATA.with(|d| *d.borrow_mut() = [0; 7]);
}
pub fn values() -> Vec<u64> {
    DATA.with(|d| d.borrow().to_vec())
}
pub fn names() -> String {
    NAMES.join("|")
}
