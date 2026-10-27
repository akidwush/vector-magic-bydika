//! Opt-in region-survival research. No state or work exists without the Cargo feature.
//!
//! Mode 0 observes the upstream predicate unchanged. Raster/reference annotations
//! never enter this module. Captures are diagnostic-only and independently capped.
use crate::ir::Segmentation;
use std::cell::RefCell;
use std::sync::Arc;
use visioncortex::ColorImage;
use visioncortex::color_clusters::{Cluster, ClustersView, NeighbourInfo};

const CAPTURE_BYTES: usize = 24 * 1024 * 1024;
const MAX_EVENTS: usize = 16384;

#[derive(Default)]
struct Capture {
    name: &'static str,
    rgba: Vec<u8>,
    labels: Vec<u32>,
}
#[derive(Default)]
struct Research {
    mode: u32,
    capture: bool,
    width: usize,
    height: usize,
    frames: Vec<Capture>,
    events: Vec<String>,
    bytes: usize,
    omitted: usize,
    evaluated: usize,
    protected: usize,
    vectors: Vec<(&'static str, String)>,
    source: Option<Arc<ColorImage>>,
    eligible: bool,
    charged_pixels: usize,
    negative_work: [usize; 3], // charged window cells, actual visited cells, probes
    negative_paints: Vec<(u32, [u8; 3])>,
    negative_paint_count: usize,
}
thread_local! {static STATE:RefCell<Research> = RefCell::new(Research::default());}

pub fn configure(mode: u32, capture: bool) {
    STATE.with(|s| {
        *s.borrow_mut() = Research {
            mode,
            capture,
            ..Research::default()
        }
    });
}
pub fn active() -> bool {
    STATE.with(|s| {
        let s = s.borrow();
        s.capture
            || ((s.mode == 2 || s.mode == 3 || s.mode == 4) && s.eligible && s.source.is_some())
    })
}
pub fn mode() -> u32 {
    STATE.with(|s| s.borrow().mode)
}
pub fn paint(id: u32, original: visioncortex::Color) -> visioncortex::Color {
    STATE.with(|s| {
        let s = s.borrow();
        if s.source.is_none() {
            return original;
        }
        s.negative_paints
            .iter()
            .find(|(key, _)| *key == id)
            .map(|(_, c)| visioncortex::Color::new(c[0], c[1], c[2]))
            .unwrap_or(original)
    })
}
pub fn precision_ablation() -> bool {
    STATE.with(|s| {
        let s = s.borrow();
        s.mode == 1 && s.eligible
    })
}
pub struct SourceGuard;
impl Drop for SourceGuard {
    fn drop(&mut self) {
        STATE.with(|s| {
            let mut s = s.borrow_mut();
            s.source = None;
            s.negative_paints.clear();
        });
    }
}
pub fn start(img: Arc<ColorImage>) -> SourceGuard {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let (mode, capture) = (s.mode, s.capture);
        let eligible = img.pixels.chunks_exact(4).all(|p| p[3] == 255);
        *s = Research {
            mode,
            capture,
            width: img.width,
            height: img.height,
            source: Some(img.clone()),
            eligible,
            ..Research::default()
        };
    });
    image("source", &img);
    SourceGuard
}
pub fn profile(name: &str) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.eligible &= name != "legacy";
    });
}
fn enabled_capture() -> bool {
    STATE.with(|s| s.borrow().capture)
}
fn room(bytes: usize) -> bool {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.bytes.saturating_add(bytes) > CAPTURE_BYTES {
            s.omitted += 1;
            false
        } else {
            s.bytes += bytes;
            true
        }
    })
}
pub fn image(name: &'static str, img: &ColorImage) {
    if !enabled_capture() || STATE.with(|s| s.borrow().frames.len() >= 8) || !room(img.pixels.len())
    {
        return;
    }
    STATE.with(|s| {
        s.borrow_mut().frames.push(Capture {
            name,
            rgba: img.pixels.clone(),
            labels: Vec::new(),
        })
    });
}
pub fn initial(view: &ClustersView<'_>) {
    if !enabled_capture() {
        return;
    }
    let n = view.width as usize * view.height as usize;
    if STATE.with(|s| s.borrow().frames.len() >= 8) || !room(n * 8) {
        return;
    }
    let mut rgba = vec![0; n * 4];
    let mut labels = Vec::with_capacity(n);
    for (i, id) in view.cluster_indices.iter().enumerate() {
        labels.push(id.0 as u32);
        let c = view.get_cluster(*id);
        if c.sum.counter > 0 {
            let c = c.color();
            rgba[i * 4..i * 4 + 4].copy_from_slice(&[c.r, c.g, c.b, 255]);
        }
    }
    STATE.with(|s| {
        s.borrow_mut().frames.push(Capture {
            name: "precision-connected-components",
            rgba,
            labels,
        })
    });
}
pub fn segmentation(name: &'static str, seg: &Segmentation) {
    if !enabled_capture() {
        return;
    }
    let n = seg.width as usize * seg.height as usize;
    if STATE.with(|s| s.borrow().frames.len() >= 8) || !room(n * 8) {
        return;
    }
    let mut rgba = vec![0; n * 4];
    let mut labels = vec![u32::MAX; n];
    let mut visited = 0usize;
    for (id, layer) in seg.layers.iter().enumerate() {
        let c = layer.paint.color();
        let m = &layer.mask;
        for y in 0..m.height() {
            for x in 0..m.width() {
                visited += 1;
                if visited > 32_000_000 {
                    STATE.with(|s| s.borrow_mut().omitted += 1);
                    return;
                }
                if !m.image.get_pixel(x, y) {
                    continue;
                }
                let xx = m.offset.x + x as i32;
                let yy = m.offset.y + y as i32;
                if xx < 0 || yy < 0 || xx >= seg.width as i32 || yy >= seg.height as i32 {
                    continue;
                }
                let i = yy as usize * seg.width as usize + xx as usize;
                labels[i] = id as u32;
                rgba[4 * i..4 * i + 4].copy_from_slice(&[c.r, c.g, c.b, c.a]);
            }
        }
    }
    STATE.with(|s| s.borrow_mut().frames.push(Capture { name, rgba, labels }));
}
pub fn partition(
    name: &'static str,
    width: usize,
    height: usize,
    ids: &[u32],
    regions: usize,
    color: impl Fn(u32) -> visioncortex::Color,
) {
    if !enabled_capture()
        || STATE.with(|s| s.borrow().frames.len() >= 8)
        || !room(width * height * 8)
    {
        return;
    }
    let mut rgba = Vec::with_capacity(ids.len() * 4);
    for &id in ids {
        let c = color(id);
        rgba.extend_from_slice(&[c.r, c.g, c.b, c.a]);
    }
    STATE.with(|s| {
        s.borrow_mut().frames.push(Capture {
            name,
            rgba,
            labels: ids.to_vec(),
        })
    });
    note(format!(
        "{{\"kind\":\"partition\",\"stage\":\"{name}\",\"regions\":{regions}}}"
    ));
}
/// Read-only compositing audit: no extra masks are kept and no merge is changed.
pub fn mosaic(stage: &str, map: &crate::mosaic::LabelMap, threshold: i32) {
    if !enabled_capture() {
        return;
    }
    let mut area = vec![0usize; map.paints.len()];
    for &label in &map.labels {
        if label != crate::mosaic::OUTSIDE {
            area[label as usize] += 1;
        }
    }
    for (id, &pixels) in area.iter().enumerate().filter(|(_, n)| **n > 0) {
        let c = map.paints[id].color();
        note(format!(
            "{{\"kind\":\"mosaic\",\"stage\":\"{stage}\",\"region\":{id},\"area\":{pixels},\"color\":[{},{},{}],\"mergeDiff\":{threshold}}}",
            c.r, c.g, c.b
        ));
    }
}
pub fn note(value: String) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.capture || value.starts_with("{\"kind\":\"configuration\"") {
            if s.events.len() < MAX_EVENTS {
                s.events.push(value)
            } else {
                s.omitted += 1;
            }
        }
    });
}
pub fn vector(name: &'static str, doc: &crate::ir::VectorDoc, writer: &crate::svg::SvgWriter) {
    if !enabled_capture() || STATE.with(|s| s.borrow().vectors.len() >= 4) {
        return;
    }
    let text = writer.write(doc);
    if text.len() > 4 * 1024 * 1024 || !room(text.len()) {
        return;
    }
    STATE.with(|s| s.borrow_mut().vectors.push((name, text)));
}
pub fn svg(index: usize) -> String {
    STATE.with(|s| {
        s.borrow()
            .vectors
            .get(index)
            .map(|s| s.1.clone())
            .unwrap_or_default()
    })
}
pub fn cluster_layers(view: &ClustersView<'_>) {
    if !enabled_capture() {
        return;
    }
    for (order, id) in view.clusters_output.iter().rev().enumerate() {
        let c = view.get_cluster(*id);
        let color = paint(id.0 as u32, c.residue_color());
        note(format!(
            "{{\"kind\":\"layer\",\"layer\":{order},\"cluster\":{},\"parent\":{},\"area\":{},\"box\":[{},{},{},{}],\"color\":[{},{},{}]}}",
            id.0,
            c.merged_into.0,
            c.area(),
            c.rect.left,
            c.rect.top,
            c.rect.width(),
            c.rect.height(),
            color.r,
            color.g,
            color.b
        ));
    }
}
/// Same ordering/strict inequalities as visioncortex 0.9.3 Runner::patch_good.
/// The private upstream function cannot be called by a custom deepen closure.
pub fn deepen(
    view: &ClustersView<'_>,
    p: &Cluster,
    ns: &[NeighbourInfo],
    min: usize,
    max: usize,
    diff: i32,
) -> bool {
    let perimeter = if min < p.area() && p.area() < max && min != 0 {
        Some(p.perimeter(view) as usize)
    } else {
        None
    };
    let good =
        min < p.area() && p.area() < max && (min == 0 || perimeter.is_some_and(|v| v < p.area()));
    let legacy = good && ns[0].diff > diff;
    STATE.with(|s| s.borrow_mut().evaluated += 1);
    let inspect = STATE.with(|s| {
        let s = s.borrow();
        (s.mode == 3 || s.mode == 4)
            && s.eligible
            && s.protected < 64
            && s.charged_pixels.saturating_add(p.area()) <= 1_000_000
    });
    let mut negative_work = [0usize; 3];
    let negative_budget = STATE.with(|s| s.borrow().negative_work[0] + 6272 <= 1_000_000);
    let evidence = if !legacy
        && inspect
        && p.area() >= 4
        && p.area() <= 4096
        && p.area() < max
        && ns[0].diff > diff
    {
        STATE.with(|s| {
            let s = s.borrow();
            s.source.as_ref().and_then(|img| {
                evidence(
                    img,
                    p,
                    view,
                    ns,
                    negative_budget,
                    s.mode == 4,
                    &mut negative_work,
                )
            })
        })
    } else {
        None
    };
    let thread_ablation = STATE.with(|s| {
        let s = s.borrow();
        s.mode == 2 && s.eligible
    }) && min < p.area()
        && p.area() < max
        && ns[0].diff > diff;
    let kept = legacy || thread_ablation || evidence.is_some();
    if inspect && !legacy {
        STATE.with(|s| s.borrow_mut().charged_pixels += p.area().min(4096));
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        for (i, value) in negative_work.into_iter().enumerate() {
            s.negative_work[i] += value;
        }
    });
    if !legacy && kept {
        STATE.with(|s| s.borrow_mut().protected += 1);
    }
    if let Some(e) = evidence {
        let background_json = e
            .background
            .map(|c| format!("[{},{},{}]", c[0], c[1], c[2]))
            .unwrap_or_else(|| "null".into());
        if let Some(color) = e.background {
            let id = view.cluster_indices[p.indices[0] as usize].0 as u32;
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                s.negative_paints.push((id, color));
                s.negative_paint_count += 1;
            });
        }
        note(format!(
            "{{\"kind\":\"protection\",\"area\":{},\"box\":[{},{},{},{}],\"reason\":\"{}\",\"stableColorFraction\":{},\"ridgeFraction\":{},\"sourceNegativePixels\":{},\"backgroundPaint\":{}}}",
            p.area(),
            p.rect.left,
            p.rect.top,
            p.rect.width(),
            p.rect.height(),
            e.reason,
            e.stable,
            e.ridge,
            e.source_core,
            background_json
        ));
    }
    if enabled_capture() && (!legacy || p.area() < 128) {
        let id = p
            .indices
            .first()
            .map(|i| view.cluster_indices[*i as usize].0)
            .unwrap_or(0);
        let c = p.color();
        note(format!(
            "{{\"kind\":\"deepen\",\"cluster\":{id},\"target\":{},\"area\":{},\"perimeter\":{},\"box\":[{},{},{},{}],\"color\":[{},{},{}],\"nearestDiff\":{},\"minArea\":{min},\"deepenDiff\":{diff},\"legacyKeep\":{legacy},\"kept\":{kept}}}",
            ns[0].index.0,
            p.area(),
            perimeter.map(|v| v.to_string()).unwrap_or("null".into()),
            p.rect.left,
            p.rect.top,
            p.rect.width(),
            p.rect.height(),
            c.r,
            c.g,
            c.b,
            ns[0].diff
        ));
    }
    kept
}
struct Evidence {
    reason: &'static str,
    stable: f64,
    ridge: f64,
    background: Option<[u8; 3]>,
    source_core: usize,
}
fn evidence(
    img: &ColorImage,
    p: &Cluster,
    view: &ClustersView<'_>,
    ns: &[NeighbourInfo],
    negative_budget: bool,
    negative_only: bool,
    negative_work: &mut [usize; 3],
) -> Option<Evidence> {
    // A compact 2x2 source core alone cannot distinguish a true counter from a
    // compression speckle. The selected subset requires extended support; the
    // rejected full model remains unchanged for reproducible ablation.
    if negative_only && p.rect.width().max(p.rect.height()) < 8 {
        return None;
    }
    if p.rect.left < 3
        || p.rect.top < 3
        || p.rect.right + 3 >= img.width as i32
        || p.rect.bottom + 3 >= img.height as i32
    {
        return None;
    }
    let at = |x: i32, y: i32| {
        let i = (y as usize * img.width + x as usize) * 4;
        [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]]
    };
    let distance = |a: [u8; 3], b: [u8; 3]| (0..3).map(|i| a[i].abs_diff(b[i])).max().unwrap();
    let mean = p.color();
    let center = [mean.r, mean.g, mean.b];
    let mut stable = 0;
    let mut ridges = 0;
    for &index in &p.indices {
        let x = (index as usize % img.width) as i32;
        let y = (index as usize / img.width) as i32;
        let c = at(x, y);
        if distance(c, center) <= 24 {
            stable += 1;
        }
        let mut ridge = false;
        for (dx, dy) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
            let mut scales = 0;
            for d in 1..=3 {
                let a = at(x + dx * d, y + dy * d);
                let b = at(x - dx * d, y - dy * d);
                if distance(a, b) <= 16 && distance(a, c) >= 24 && distance(b, c) >= 24 {
                    scales += 1;
                }
            }
            if scales >= 2 {
                ridge = true;
                break;
            }
        }
        if ridge {
            ridges += 1;
        }
    }
    let stable = stable as f64 / p.area() as f64;
    let ridge = ridges as f64 / p.area() as f64;
    if stable < 0.70 {
        return None;
    }
    let corner = at(0, 0);
    let background = [
        at(img.width as i32 - 1, 0),
        at(0, img.height as i32 - 1),
        at(img.width as i32 - 1, img.height as i32 - 1),
    ]
    .iter()
    .all(|c| distance(*c, corner) <= 8);
    let target = view.get_cluster(ns[0].index).color();
    let target = [target.r, target.g, target.b];
    if background
        && negative_budget
        && distance(target, corner) >= 48
        && distance(center, corner) as usize * 4 < distance(target, corner) as usize
    {
        if let Some(core) = closed_background(img, p, corner, target, negative_work) {
            return Some(Evidence {
                reason: "source-enclosed-background",
                stable,
                ridge,
                background: Some(corner),
                source_core: core,
            });
        }
    }
    let long = p.rect.width().max(p.rect.height()) >= 8;
    if !negative_only && long && ridge >= 0.55 && ridges >= 6 {
        return Some(Evidence {
            reason: "multiscale-ridge",
            stable,
            ridge,
            background: None,
            source_core: 0,
        });
    }
    None
}
/// Certify one source-only 8-connected negative component under both 8 and 16
/// channel uncertainty. A local-window escape, multiple source holes, or weak
/// paint evidence rejects the hypothesis. No global relabeling or mask insertion.
fn closed_background(
    img: &ColorImage,
    p: &Cluster,
    bg: [u8; 3],
    parent: [u8; 3],
    work: &mut [usize; 3],
) -> Option<usize> {
    if p.rect.width() > 48 || p.rect.height() > 48 {
        return None;
    }
    let left = (p.rect.left - 4).max(0);
    let top = (p.rect.top - 4).max(0);
    let right = (p.rect.right + 4).min(img.width as i32);
    let bottom = (p.rect.bottom + 4).min(img.height as i32);
    let w = (right - left) as usize;
    let h = (bottom - top) as usize;
    let color = |x: usize, y: usize| {
        let i = ((top as usize + y) * img.width + left as usize + x) * 4;
        [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]]
    };
    let dist = |a: [u8; 3], b: [u8; 3]| (0..3).map(|i| a[i].abs_diff(b[i])).max().unwrap();
    let seeds: Vec<usize> = p
        .indices
        .iter()
        .filter_map(|&i| {
            let x = i as usize % img.width - left as usize;
            let y = i as usize / img.width - top as usize;
            (dist(color(x, y), bg) <= 8).then_some(y * w + x)
        })
        .collect();
    if seeds.len() < 4 {
        return None;
    }
    work[0] += 2 * w * h;
    work[2] += 1;
    // First require closure at the looser uncertainty level. All owned bright
    // samples must belong to this one component; never bridge two source gaps.
    let mut loose = vec![false; w * h];
    let mut stack = vec![seeds[0]];
    loose[seeds[0]] = true;
    while let Some(i) = stack.pop() {
        work[1] += 1;
        let x = i % w;
        let y = i / w;
        if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
            return None;
        }
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let xx = (x as i32 + dx) as usize;
                let yy = (y as i32 + dy) as usize;
                let j = yy * w + xx;
                if !loose[j] && dist(color(xx, yy), bg) <= 16 {
                    loose[j] = true;
                    stack.push(j);
                }
            }
        }
    }
    if seeds.iter().any(|i| !loose[*i]) {
        return None;
    }
    let mut owned = vec![false; w * h];
    for &i in &seeds {
        owned[i] = true;
    }
    let mut tight = vec![false; w * h];
    let mut core = 0;
    for seed in 0..w * h {
        if !loose[seed] || tight[seed] || dist(color(seed % w, seed / w), bg) > 8 {
            continue;
        }
        stack.clear();
        stack.push(seed);
        tight[seed] = true;
        let mut size = 0;
        let mut support = 0;
        while let Some(i) = stack.pop() {
            work[1] += 1;
            size += 1;
            if owned[i] {
                support += 1;
            }
            let x = i % w;
            let y = i / w;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let xx = (x as i32 + dx) as usize;
                    let yy = (y as i32 + dy) as usize;
                    let j = yy * w + xx;
                    if loose[j] && !tight[j] && dist(color(xx, yy), bg) <= 8 {
                        tight[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        // Isolated <4px threshold fragments may be antialias fringes. Two
        // meaningful tight components remain ambiguous and must not be merged.
        if size >= 4 {
            if size > 256 || support < 4 || core != 0 {
                return None;
            }
            core = size;
        }
    }
    if core < 4 {
        return None;
    }
    let (mut before, mut after) = (0usize, 0usize);
    for &i in &p.indices {
        let j = i as usize * 4;
        for c in 0..3 {
            before += img.pixels[j + c].abs_diff(parent[c]) as usize;
            after += img.pixels[j + c].abs_diff(bg[c]) as usize;
        }
    }
    (after * 4 <= before * 3).then_some(core)
}
pub fn rgba(index: usize) -> Vec<u8> {
    STATE.with(|s| {
        s.borrow()
            .frames
            .get(index)
            .map(|f| f.rgba.clone())
            .unwrap_or_default()
    })
}
pub fn labels(index: usize) -> Vec<u32> {
    STATE.with(|s| {
        s.borrow()
            .frames
            .get(index)
            .map(|f| f.labels.clone())
            .unwrap_or_default()
    })
}
pub fn report() -> String {
    STATE.with(|s| {let s=s.borrow(); let frames=s.frames.iter().map(|f|format!("\"{}\"",f.name)).collect::<Vec<_>>().join(",");
        let vectors=s.vectors.iter().map(|s|format!("\"{}\"",s.0)).collect::<Vec<_>>().join(",");
        format!("{{\"mode\":{},\"width\":{},\"height\":{},\"captureBytes\":{},\"omitted\":{},\"evaluated\":{},\"protected\":{},\"chargedCandidatePixels\":{},\"negativeProbeCellBudget\":{},\"negativeProbePixelsVisited\":{},\"negativeProbes\":{},\"negativePaints\":{},\"cacheEntries\":{},\"eligible\":{},\"sourceRetained\":{},\"frames\":[{frames}],\"vectors\":[{vectors}],\"events\":[{}]}}",s.mode,s.width,s.height,s.bytes,s.omitted,s.evaluated,s.protected,s.charged_pixels,s.negative_work[0],s.negative_work[1],s.negative_work[2],s.negative_paint_count,s.negative_paints.len(),s.eligible,s.source.is_some(),s.events.join(","))})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontend::{ColorClusterFrontend, Frontend};
    fn raster(w: usize, h: usize, f: impl Fn(usize, usize) -> u8) -> Arc<ColorImage> {
        let mut pixels = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let c = f(x, y);
                pixels.extend_from_slice(&[c, c, c, 255]);
            }
        }
        Arc::new(ColorImage {
            width: w,
            height: h,
            pixels,
        })
    }
    fn visible(img: &Arc<ColorImage>, mode: u32) -> Vec<u8> {
        configure(mode, true);
        let guard = start(img.clone());
        profile("coverage-adaptive");
        let seg = ColorClusterFrontend {
            good_min_area: 4,
            ..ColorClusterFrontend::default()
        }
        .segment(img)
        .unwrap();
        segmentation("result", &seg);
        let result = STATE.with(|s| s.borrow().frames.last().unwrap().rgba.clone());
        drop(guard);
        result
    }
    #[test]
    fn negative_only_ablation_does_not_promote_colored_ridges() {
        let line = raster(40, 24, |x, y| {
            if y == 12 && (6..34).contains(&x) {
                48
            } else {
                255
            }
        });
        assert_eq!(visible(&line, 0), visible(&line, 4));
        let gap = raster(40, 32, |x, y| {
            if (5..35).contains(&x)
                && (5..27).contains(&y)
                && !((12..28).contains(&x) && (15..17).contains(&y))
            {
                30
            } else {
                255
            }
        });
        let old = visible(&gap, 0);
        let new = visible(&gap, 4);
        let i = (15 * 40 + 20) * 4;
        assert!(old[i] < 100, "legacy absorption should fill the source gap");
        assert!(
            new[i] > 245,
            "certified negative gap survives without ridge protection"
        );
        STATE.with(|s| {
            let s = s.borrow();
            assert!(s.protected <= 64);
            assert!(s.source.is_none());
            assert!(s.negative_paints.is_empty());
        });
    }
    #[test]
    fn selected_subset_keeps_compact_ambiguous_counters_at_baseline() {
        let ambiguous = raster(32, 28, |x, y| {
            if (6..26).contains(&x)
                && (6..22).contains(&y)
                && !((15..17).contains(&x) && (13..15).contains(&y))
            {
                30
            } else {
                255
            }
        });
        // These same four source pixels could be an intentional counter or a
        // speckle. Source-only compact support cannot resolve that distinction.
        assert_eq!(visible(&ambiguous, 0), visible(&ambiguous, 4));
    }
    #[test]
    fn coherent_ridge_survives_without_retaining_one_sided_aa_band() {
        let img = raster(40, 24, |x, y| {
            if y == 12 && (6..34).contains(&x) {
                48
            } else {
                255
            }
        });
        let a = visible(&img, 0);
        let b = visible(&img, 3);
        let i = (12 * 40 + 20) * 4;
        assert!(a[i] > 200, "upstream should absorb the thread");
        assert!(b[i] < 80, "source-supported line must retain its paint");
        let band = raster(40, 24, |x, _| {
            if x < 19 {
                0
            } else if x == 19 {
                128
            } else {
                255
            }
        });
        assert_eq!(
            visible(&band, 0),
            visible(&band, 3),
            "one-sided coverage must not become a separate region"
        );
    }
    #[test]
    fn compact_background_counter_is_preserved_without_zeroing_speckle() {
        let img = raster(32, 28, |x, y| {
            if (6..26).contains(&x)
                && (6..22).contains(&y)
                && !((15..17).contains(&x) && (13..15).contains(&y))
            {
                30
            } else {
                255
            }
        });
        let a = visible(&img, 0);
        let b = visible(&img, 3);
        let i = (13 * 32 + 15) * 4;
        assert!(a[i] < 100);
        assert!(b[i] > 240);
    }
    #[test]
    fn negative_paint_uses_source_background_and_rejects_uncertain_escape() {
        let img = raster(32, 28, |x, y| {
            if (15..17).contains(&x) && (11..19).contains(&y) {
                if y == 11 || y == 18 { 210 } else { 224 }
            } else if (6..26).contains(&x) && (6..22).contains(&y) {
                20
            } else {
                229
            }
        });
        let a = visible(&img, 0);
        let b = visible(&img, 3);
        let i = (14 * 32 + 15) * 4;
        assert!(a[i] < 100);
        assert_eq!(b[i], 229, "must reuse the actual non-white background");
        let uncertain = raster(32, 28, |x, y| {
            if (15..17).contains(&x) && (13..15).contains(&y) {
                255
            } else if x == 15 && (6..13).contains(&y) {
                243
            } else if (6..26).contains(&x) && (6..22).contains(&y) {
                20
            } else {
                255
            }
        });
        visible(&uncertain, 3);
        assert!(
            STATE.with(|s| s.borrow().negative_paint_count == 0),
            "a looser-connectivity escape must not be certified as an enclosed background region"
        );
    }
    #[test]
    fn unsupported_legacy_route_does_not_execute_source_classifier() {
        let img = raster(40, 24, |x, y| {
            if y == 12 && (6..34).contains(&x) {
                48
            } else {
                255
            }
        });
        configure(3, false);
        let _guard = start(img.clone());
        profile("legacy");
        ColorClusterFrontend {
            good_min_area: 4,
            ..ColorClusterFrontend::default()
        }
        .segment(&img)
        .unwrap();
        STATE.with(|s| {
            let s = s.borrow();
            assert_eq!(s.evaluated, 0);
            assert_eq!(s.charged_pixels, 0);
            assert_eq!(s.protected, 0);
        });
    }
    #[test]
    fn aa_fringe_does_not_hide_a_stable_core_or_merge_two_real_cores() {
        let img = raster(32, 30, |x, y| {
            if (15..17).contains(&x) && (8..22).contains(&y) {
                match y {
                    8 | 21 => 235,
                    9 | 20 => 247,
                    10 | 19 => 246,
                    _ => 249,
                }
            } else if (6..26).contains(&x) && (6..25).contains(&y) {
                20
            } else {
                255
            }
        });
        let a = visible(&img, 0);
        let b = visible(&img, 3);
        let i = (14 * 32 + 15) * 4;
        assert!(a[i] < 100);
        assert_eq!(b[i], 255);
        assert!(STATE.with(|s| s.borrow().negative_paint_count > 0));
        assert!(
            STATE.with(|s| s.borrow().negative_paints.is_empty()),
            "overrides must be invalid after the source guard drops"
        );
        let two = raster(32, 28, |x, y| {
            if (15..17).contains(&x) && ((9..11).contains(&y) || (14..16).contains(&y)) {
                255
            } else if (15..17).contains(&x) && (11..14).contains(&y) {
                245
            } else if (6..26).contains(&x) && (6..22).contains(&y) {
                20
            } else {
                255
            }
        });
        visible(&two, 3);
        assert_eq!(STATE.with(|s| s.borrow().negative_paint_count), 0);
    }
    #[test]
    fn uncertain_isolated_pixels_and_intrinsic_alpha_keep_the_legacy_result() {
        let img = raster(32, 24, |x, y| if (x, y) == (16, 12) { 0 } else { 255 });
        assert_eq!(visible(&img, 0), visible(&img, 3));
        let mut partial = (*raster(40, 24, |x, y| {
            if y == 12 && (6..34).contains(&x) {
                48
            } else {
                255
            }
        }))
        .clone();
        partial.pixels[3] = 128;
        let partial = Arc::new(partial);
        assert_eq!(visible(&partial, 0), visible(&partial, 3));
    }
    #[test]
    fn source_guard_releases_image_on_error_or_completion() {
        let img = raster(8, 8, |_, _| 255);
        configure(3, false);
        {
            let _guard = start(img.clone());
            assert_eq!(Arc::strong_count(&img), 2);
        }
        assert_eq!(Arc::strong_count(&img), 1);
        assert!(STATE.with(|s| s.borrow().source.is_none()));
    }
    #[test]
    fn diagnostic_only_result_matches_unmodified_frontend() {
        let img = raster(40, 24, |x, y| {
            if y == 12 && (6..34).contains(&x) {
                48
            } else {
                255
            }
        });
        let expected = visible(&img, 0);
        configure(0, false);
        let _guard = start(img.clone());
        let seg = ColorClusterFrontend {
            good_min_area: 4,
            ..ColorClusterFrontend::default()
        }
        .segment(&img)
        .unwrap();
        configure(0, true);
        segmentation("unmodified", &seg);
        assert_eq!(
            expected,
            STATE.with(|s| s.borrow().frames.last().unwrap().rgba.clone())
        );
    }
}
