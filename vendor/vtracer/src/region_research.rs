//! Source-only, bounded experiment. Mode 0 is exact legacy; 1 mosaic, 2 cut,
//! 3 both. No reference paths, filenames, second rasterizer or tracing engine.
use std::{cell::RefCell, collections::BTreeMap, sync::Arc};
use visioncortex::ColorImage;

pub const MAX_PIXELS: usize = 512 * 512;
pub const MAX_TRIALS: usize = 128;
pub const MAX_SPLITS: usize = 24;
pub const MAX_EXAMINED: usize = 1_000_000;
#[derive(Default)]
struct State {
    mode: u32,
    source: Option<Arc<ColorImage>>,
    eligible: bool,
    trials: usize,
    examined: usize,
    cut: usize,
    veto: usize,
    events: Vec<String>,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
pub fn configure(mode: u32) {
    STATE.with(|s| s.borrow_mut().mode = mode.min(3));
}
pub fn mode() -> u32 {
    STATE.with(|s| s.borrow().mode)
}
pub fn eligible(img: &ColorImage) -> bool {
    if img.width * img.height > MAX_PIXELS || img.width < 16 || img.height < 16 {
        return false;
    }
    let mut lo = [255u8; 3];
    let mut hi = [0u8; 3];
    let mut counts = BTreeMap::<[u8; 3], usize>::new();
    for p in img.pixels.chunks_exact(4) {
        if p[3] != 255 {
            return false;
        }
        for c in 0..3 {
            lo[c] = lo[c].min(p[c]);
            hi[c] = hi[c].max(p[c]);
        }
        if (0..3).any(|c| hi[c] - lo[c] > 64) {
            return false;
        }
        *counts.entry([p[0], p[1], p[2]]).or_default() += 1;
        if counts.len() > 4096 {
            return false;
        }
    }
    let mut values: Vec<_> = counts.values().copied().collect();
    values.sort_unstable_by(|a, b| b.cmp(a));
    values.iter().take(64).sum::<usize>() * 100 >= img.width * img.height * 90
}
pub struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        STATE.with(|s| s.borrow_mut().source = None);
    }
}
pub fn start(img: Arc<ColorImage>) -> Guard {
    STATE.with(|s| {
        let mode = s.borrow().mode;
        *s.borrow_mut() = State {
            mode,
            eligible: eligible(&img),
            source: Some(img),
            ..State::default()
        };
    });
    Guard
}
pub fn event(e: String) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.events.len() < 512 {
            s.events.push(e);
        }
    });
}
pub fn report() -> String {
    STATE.with(|s| {let s=s.borrow();format!("{{\"mode\":{},\"eligible\":{},\"trials\":{},\"examined\":{},\"cutProtected\":{},\"mergeVetoes\":{},\"sourceRetained\":{},\"events\":[{}]}}",s.mode,s.eligible,s.trials,s.examined,s.cut,s.veto,s.source.is_some(),s.events.join(","))})
}
pub fn active(bit: u32) -> bool {
    STATE.with(|s| {
        let s = s.borrow();
        s.eligible && s.source.is_some() && s.mode & bit != 0
    })
}
pub fn changed() -> bool {
    STATE.with(|s| {
        let s = s.borrow();
        s.cut + s.veto > 0
    })
}
fn source() -> Option<Arc<ColorImage>> {
    STATE.with(|s| s.borrow().source.clone())
}
fn charge(n: usize) -> bool {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.trials >= MAX_TRIALS || s.examined + n > MAX_EXAMINED {
            false
        } else {
            s.trials += 1;
            s.examined += n;
            true
        }
    })
}
fn rgb(img: &ColorImage, p: usize) -> [f64; 3] {
    let i = p * 4;
    [
        img.pixels[i] as f64,
        img.pixels[i + 1] as f64,
        img.pixels[i + 2] as f64,
    ]
}
fn linf(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|c| (a[c] - b[c]).abs()).fold(0., f64::max)
}
/// Stable two-sided observations at radii one and two, along seven parallel
/// transects. Same-color/gradient samples and a single anomalous pixel fail.
fn support(img: &ColorImage, p: usize, q: usize, a: [f64; 3], b: [f64; 3]) -> usize {
    let w = img.width as i32;
    let h = img.height as i32;
    let (px, py) = ((p % img.width) as i32, (p / img.width) as i32);
    let (qx, qy) = ((q % img.width) as i32, (q / img.width) as i32);
    let (dx, dy) = (qx - px, qy - py);
    let (tx, ty) = (-dy, dx);
    let at = |x: i32, y: i32| -> Option<[f64; 3]> {
        if x < 0 || y < 0 || x >= w || y >= h {
            None
        } else {
            Some(rgb(img, (y * w + x) as usize))
        }
    };
    let Some(ca) = at(px - 2 * dx, py - 2 * dy) else {
        return 0;
    };
    let Some(cb) = at(qx + 2 * dx, qy + 2 * dy) else {
        return 0;
    };
    if linf(ca, cb) < 6. || (0..3).map(|k| (ca[k] - cb[k]) * (a[k] - b[k])).sum::<f64>() <= 0. {
        return 0;
    }
    let mut ok = 0;
    for t in -3..=3 {
        let mut good = true;
        for r in 1..=3 {
            let c = at(px + t * tx - r * dx, py + t * ty - r * dy);
            let d = at(qx + t * tx + r * dx, qy + t * ty + r * dy);
            if !matches!((c,d),(Some(c),Some(d))if linf(c,ca)<=2.5&&linf(d,cb)<=2.5&&linf(c,d)>=6.)
            {
                good = false;
                break;
            }
        }
        if good {
            ok += 1;
        }
    }
    ok
}
/// Called only for an MST edge that the unchanged persistence cut would merge.
/// The roots/stats are CURRENT, not cached across unions. Removing a tree edge
/// preserves an existing hierarchy split; it never inserts pixel labels.
pub fn cut_veto(
    p: u32,
    q: u32,
    aa: u64,
    ab: u64,
    sa: [u64; 3],
    sb: [u64; 3],
    va: [u64; 3],
    vb: [u64; 3],
    persistence: u64,
) -> bool {
    if !active(2) || aa < 16 || ab < 16 || persistence == 0 {
        return false;
    }
    let a = sa.map(|v| v as f64 / aa as f64);
    let b = sb.map(|v| v as f64 / ab as f64);
    if linf(a, b) < 6. || linf(a, b) > 40. {
        return false;
    }
    if (0..3).any(|c| {
        va[c] as f64 / aa as f64 - a[c] * a[c] > 2.25
            || vb[c] as f64 / ab as f64 - b[c] * b[c] > 2.25
    }) {
        return false;
    }
    if !charge(5 * 42) {
        return false;
    }
    let Some(img) = source() else { return false };
    let (p, q) = (p as usize, q as usize);
    let delta = q - p;
    let w = img.width;
    let tx = if q - p == 1 { 0isize } else { 1 };
    let ty = if q - p == 1 { 1isize } else { 0 };
    let supported = [-6isize, -3, 0, 3, 6]
        .into_iter()
        .filter_map(|t| {
            let x = p % w;
            let y = p / w;
            let nx = x as isize + t * tx;
            let ny = y as isize + t * ty;
            if nx < 0 || ny < 0 || nx >= w as isize || ny >= img.height as isize {
                None
            } else {
                let p = (ny as usize) * w + nx as usize;
                Some(support(&img, p, p + delta, a, b))
            }
        })
        .max()
        .unwrap_or(0);
    let keep = supported >= 5 && STATE.with(|s| s.borrow().cut < MAX_SPLITS);
    event(format!(
        "{{\"reason\":\"WATERSHED_CUT_MERGE\",\"pixels\":[{p},{q}],\"area\":[{aa},{ab}],\"means\":[{a:?},{b:?}],\"persistence\":{persistence},\"supported\":{supported},\"protected\":{keep}}}"
    ));
    if keep {
        STATE.with(|s| s.borrow_mut().cut += 1);
    }
    keep
}
/// Evaluate all CURRENT boundary observations for the proposed union. The
/// caller resolves every original endpoint through the current union-find.
/// No decision survives a membership/color change.
pub fn merge_veto(
    a: u32,
    b: u32,
    aa: u64,
    ab: u64,
    sa: [u64; 3],
    sb: [u64; 3],
    edges: &[(usize, usize)],
    threshold: i32,
) -> bool {
    if !active(1)
        || aa < 16
        || ab < 16
        || edges.len() < 12
        || edges.len() > 8192
        || !charge(edges.len().min(256) * 42)
    {
        return false;
    }
    let Some(img) = source() else { return false };
    let ca = sa.map(|v| v as f64 / aa as f64);
    let cb = sb.map(|v| v as f64 / ab as f64);
    let mut supported = 0;
    let mut before = 0.;
    let mut after = 0.;
    let mut sampled = 0;
    let merged: [f64; 3] = std::array::from_fn(|c| (sa[c] + sb[c]) as f64 / (aa + ab) as f64);
    for &(p, q) in edges.iter().step_by((edges.len() / 128).max(1)).take(256) {
        // Paints are part of the evidence: retaining an identical or distorted
        // palette color cannot pass just because source pixels differ.
        if support(&img, p, q, ca, cb) >= 5 {
            supported += 1;
        }
        for (i, c) in [(p, ca), (q, cb)] {
            let s = rgb(&img, i);
            for k in 0..3 {
                before += (s[k] - merged[k]).abs();
                after += (s[k] - c[k]).abs();
            }
        }
        sampled += 1;
    }
    let keep = linf(ca, cb) >= 6.
        && supported >= 12
        && supported * 100 >= sampled * 65
        && after + 1e-9 < before * 0.75
        && STATE.with(|s| s.borrow().veto < MAX_SPLITS);
    event(format!(
        "{{\"reason\":\"MOSAIC_ADJACENCY_MERGE\",\"roots\":[{a},{b}],\"area\":[{aa},{ab}],\"means\":[{ca:?},{cb:?}],\"threshold\":{threshold},\"boundaryLength\":{},\"sampled\":{sampled},\"supported\":{supported},\"before\":{before},\"after\":{after},\"protected\":{keep}}}",
        edges.len()
    ));
    if keep {
        STATE.with(|s| s.borrow_mut().veto += 1);
    }
    keep
}

pub fn scan(n: usize) -> bool {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.examined + n > MAX_EXAMINED {
            false
        } else {
            s.examined += n;
            true
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn image(noise: bool) -> Arc<ColorImage> {
        let mut pixels = Vec::new();
        for y in 0..32 {
            for x in 0..32 {
                let c = if noise {
                    240 + ((x * 13 + y * 17) % 15) as u8
                } else if x < 16 {
                    252
                } else {
                    240
                };
                pixels.extend([c, c, c, 255]);
            }
        }
        Arc::new(ColorImage {
            width: 32,
            height: 32,
            pixels,
        })
    }
    #[test]
    fn scope_cleanup_and_mode_zero_are_exact() {
        configure(0);
        {
            let _g = start(image(false));
            assert!(!active(1));
            assert!(!active(2));
        }
        assert!(report().contains("\"sourceRetained\":false"));
    }
    #[test]
    fn coherent_paint_boundary_vetoed_only_in_mosaic_mode() {
        configure(1);
        let _g = start(image(false));
        let es: Vec<_> = (3..29).map(|y| (y * 32 + 15, y * 32 + 16)).collect();
        assert!(merge_veto(
            0,
            1,
            512,
            512,
            [252 * 512; 3],
            [240 * 512; 3],
            &es,
            40
        ));
        configure(2);
        assert!(!merge_veto(
            0,
            1,
            512,
            512,
            [252 * 512; 3],
            [240 * 512; 3],
            &es,
            40
        ));
    }
    #[test]
    fn updated_equal_paints_cannot_reuse_previous_veto() {
        configure(1);
        let _g = start(image(false));
        let es: Vec<_> = (3..29).map(|y| (y * 32 + 15, y * 32 + 16)).collect();
        assert!(!merge_veto(
            0,
            1,
            512,
            512,
            [246 * 512; 3],
            [246 * 512; 3],
            &es,
            40
        ));
    }
    #[test]
    fn incoherent_noise_cannot_veto() {
        configure(1);
        let _g = start(image(true));
        let es: Vec<_> = (3..29).map(|y| (y * 32 + 15, y * 32 + 16)).collect();
        assert!(!merge_veto(
            0,
            1,
            512,
            512,
            [252 * 512; 3],
            [240 * 512; 3],
            &es,
            40
        ));
    }
    #[test]
    fn transparency_rejected() {
        let mut a = (*image(false)).clone();
        a.pixels[3] = 128;
        assert!(!eligible(&a));
    }
    #[test]
    fn gradient_rejected_by_local_plateau_test() {
        configure(1);
        let mut a = (*image(false)).clone();
        for y in 0..32 {
            for x in 0..32 {
                for c in 0..3 {
                    a.pixels[(y * 32 + x) * 4 + c] = 220 + x as u8;
                }
            }
        }
        let _g = start(Arc::new(a));
        let es: Vec<_> = (3..29).map(|y| (y * 32 + 15, y * 32 + 16)).collect();
        assert!(!merge_veto(
            0,
            1,
            512,
            512,
            [228 * 512; 3],
            [244 * 512; 3],
            &es,
            50
        ));
    }
    #[test]
    fn budget_fails_to_legacy_without_retaining_source() {
        configure(3);
        {
            let _g = start(image(false));
            assert!(scan(MAX_EXAMINED));
            assert!(!scan(1));
            assert!(!charge(1));
        }
        assert!(source().is_none());
    }
}

#[cfg(test)]
mod partition_tests{
 use super::*;use crate::{frontend::watershed::WatershedHierarchy,mosaic::LabelMap,ir::Paint};
 fn scene()->Arc<ColorImage>{Arc::new(ColorImage{width:32,height:32,pixels:(0..1024).flat_map(|p|{let c=if p%32<16{252}else{240};[c,c,c,255]}).collect()})}
 #[test]fn retains_an_existing_tree_split_without_changing_detail(){let img=scene();let tree=WatershedHierarchy::build(&img).unwrap();configure(0);let a={let _s=start(img.clone());LabelMap::from_segmentation(&tree.cut(&img,0,4))};configure(2);let b={let _s=start(img.clone());LabelMap::from_segmentation(&tree.cut(&img,0,4))};assert_eq!(a.paints.len(),1);assert!(b.labels[0]!=b.labels[31]);assert!(report().contains("\"cutProtected\":1"));}
 #[test]fn protected_map_has_dense_ids_correct_paints_and_complete_ownership(){let img=scene();configure(1);let _g=start(img);let mut map=LabelMap{width:32,height:32,labels:(0..1024).map(|p|if p%32<16{0}else{1}).collect(),paints:vec![Paint::Solid(visioncortex::Color::new(252,252,252)),Paint::Solid(visioncortex::Color::new(240,240,240))]};map.merge_similar(40);assert_eq!(map.paints.len(),2);assert!(map.labels.iter().all(|l|(*l as usize)<map.paints.len()));assert_eq!(map.paints[map.labels[0]as usize].color().r,252);assert_eq!(map.paints[map.labels[31]as usize].color().r,240);}
}
