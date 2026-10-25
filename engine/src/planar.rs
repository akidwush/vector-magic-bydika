//! Constrained composition of upstream VTracer Mosaic. No new segmentation or tracer.
use std::collections::{HashMap, HashSet};
use vtracer::{
    PointF64,
    ir::{Segmentation, VectorDoc},
    mosaic::{
        self, BoundaryGraph, FittedGeom, FittedSegment, LabelMap, OUTSIDE, PixelSegmentFitter,
        PolygonSegmentFitter, SegmentFitter, SplineSegmentFitter, face,
    },
};

#[derive(Default, Clone, Debug)]
pub struct Stats {
    pub vertices: usize,
    pub edges: usize,
    pub faces: usize,
    pub shared: usize,
    pub contours: usize,
    pub incidence_errors: usize,
    pub repaired: usize,
    pub crossings_before: usize,
    pub crossings_after: usize,
    pub max_drift: f64,
    pub pixel_fallback: bool,
    pub validation_budget_fallback: bool,
    pub adaptive_rollback: bool,
    pub source_accepted: usize,
}
impl Stats {
    pub fn values(&self) -> Vec<f64> {
        vec![
            self.vertices as f64,
            self.edges as f64,
            self.faces as f64,
            self.shared as f64,
            self.contours as f64,
            self.incidence_errors as f64,
            self.repaired as f64,
            self.crossings_before as f64,
            self.crossings_after as f64,
            self.max_drift,
            self.pixel_fallback as u8 as f64,
            self.validation_budget_fallback as u8 as f64,
            self.adaptive_rollback as u8 as f64,
            self.source_accepted as f64,
        ]
    }
}
fn p(x: f64, y: f64) -> PointF64 {
    PointF64 { x, y }
}
fn dist(a: PointF64, b: PointF64) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn cross(a: PointF64, b: PointF64, c: PointF64) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
fn near(a: PointF64, b: PointF64) -> bool {
    dist(a, b) < 1e-7
}
fn point_line(q: PointF64, a: PointF64, b: PointF64) -> f64 {
    let d = (b.x - a.x).powi(2) + (b.y - a.y).powi(2);
    if d == 0. {
        return dist(q, a);
    }
    let t = (((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / d).clamp(0., 1.);
    dist(q, p(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)))
}
fn mid(a: PointF64, b: PointF64) -> PointF64 {
    p((a.x + b.x) / 2., (a.y + b.y) / 2.)
}
fn cubic(c: [PointF64; 4], out: &mut Vec<PointF64>, depth: u8) {
    if out.len() > 32768 {
        return;
    }
    // Adaptive flattening for validation, <=.002px control-polygon flatness.
    let flatness = point_line(c[1], c[0], c[3]).max(point_line(c[2], c[0], c[3]));
    if flatness <= 0.002 {
        line(c[0], c[3], out);
        return;
    }
    if depth >= 18 {
        // Fail closed: drift validation rejects this unresolved approximation.
        out.push(p(f64::NAN, f64::NAN));
        return;
    }
    let a = mid(c[0], c[1]);
    let b = mid(c[1], c[2]);
    let d = mid(c[2], c[3]);
    let e = mid(a, b);
    let f = mid(b, d);
    let g = mid(e, f);
    cubic([c[0], a, e, g], out, depth + 1);
    cubic([g, f, d, c[3]], out, depth + 1);
}
fn line(a: PointF64, b: PointF64, out: &mut Vec<PointF64>) {
    let n = ((dist(a, b) / 2.).ceil().max(1.) as usize).min(32769usize.saturating_sub(out.len()));
    for i in 1..=n {
        let t = i as f64 / n as f64;
        out.push(p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
}
pub(crate) fn flatten(g: &FittedGeom) -> Vec<PointF64> {
    let mut out = Vec::new();
    match g {
        FittedGeom::Polyline(ps) => {
            if let Some(a) = ps.first() {
                out.push(*a);
                for w in ps.windows(2) {
                    line(w[0], w[1], &mut out)
                }
            }
        }
        FittedGeom::Beziers(cs) => {
            if let Some(c) = cs.first() {
                out.push(c[0]);
                for c in cs {
                    cubic(*c, &mut out, 0)
                }
            }
        }
    }
    out
}
pub(crate) fn aligned(seg: &mosaic::Segment, g: &FittedGeom) -> bool {
    let raw: Vec<_> = seg
        .points
        .iter()
        .map(|q| p(q.x as f64, q.y as f64))
        .collect();
    let a = flatten(g);
    if a.is_empty() {
        return false;
    }
    let bounds = |ps: &[PointF64]| {
        [
            ps.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            ps.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            ps.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            ps.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ]
    };
    bounds(&raw)
        .into_iter()
        .zip(bounds(&a))
        .all(|(a, b)| (a - b).abs() <= 2.)
}
pub(crate) fn valid_model(seg: &mosaic::Segment, g: &FittedGeom, w: u32, h: u32) -> bool {
    if drift_bounded(seg, g, w, h, drift_limit(seg) + 0.5).is_none() {
        return false;
    }
    let graph = BoundaryGraph {
        nodes: Vec::new(),
        segments: vec![seg.clone()],
    };
    matches!(collisions(&graph,&[FittedSegment{geom:g.clone()}]),Ok(bad) if bad.is_empty())
}
pub(crate) fn replacement_clear(g: &FittedGeom, others: &[FittedGeom]) -> bool {
    let fitted: Vec<_> = std::iter::once(g)
        .chain(others)
        .map(|g| FittedSegment { geom: g.clone() })
        .collect();
    let graph = BoundaryGraph {
        nodes: Vec::new(),
        segments: fitted
            .iter()
            .map(|f| mosaic::Segment {
                points: flatten(&f.geom)
                    .iter()
                    .map(|q| vtracer::PointI32 {
                        x: q.x.round() as i32,
                        y: q.y.round() as i32,
                    })
                    .collect(),
                start: None,
                end: None,
                left: 0,
                right: 1,
                first_dir: 0,
                last_dir: 0,
            })
            .collect(),
    };
    matches!(collisions(&graph,&fitted),Ok(bad) if !bad.contains(&0))
}
fn endpoints(g: &FittedGeom) -> Option<(PointF64, PointF64)> {
    match g {
        FittedGeom::Polyline(ps) => Some((*ps.first()?, *ps.last()?)),
        FittedGeom::Beziers(cs) => Some((cs.first()?[0], cs.last()?[3])),
    }
}
fn quantize(g: &mut FittedGeom) {
    let round = |v: &mut PointF64| {
        v.x = (v.x * 1e6).round() / 1e6;
        v.y = (v.y * 1e6).round() / 1e6;
    };
    match g {
        FittedGeom::Polyline(ps) => ps.iter_mut().for_each(round),
        FittedGeom::Beziers(cs) => cs.iter_mut().for_each(|c| c.iter_mut().for_each(round)),
    }
}
fn drift_limit(seg: &mosaic::Segment) -> f64 {
    let x0 = seg.points.iter().map(|p| p.x).min().unwrap_or(0);
    let x1 = seg.points.iter().map(|p| p.x).max().unwrap_or(0);
    let y0 = seg.points.iter().map(|p| p.y).min().unwrap_or(0);
    let y1 = seg.points.iter().map(|p| p.y).max().unwrap_or(0);
    // Small closed details (eyes/nose) cannot afford the same absolute shift.
    if (x1 - x0).max(y1 - y0) <= 16 {
        0.75
    } else {
        1.0
    }
}

fn drift(seg: &mosaic::Segment, g: &FittedGeom, w: u32, h: u32) -> Option<f64> {
    drift_bounded(seg, g, w, h, drift_limit(seg))
}
fn drift_bounded(seg: &mosaic::Segment, g: &FittedGeom, w: u32, h: u32, limit: f64) -> Option<f64> {
    if let FittedGeom::Beziers(cs) = g {
        if cs.windows(2).any(|w| !near(w[0][3], w[1][0])) {
            return None;
        }
    }
    let flat = flatten(g);
    if flat.len() < 2 || flat.len() > 32768 {
        return None;
    }
    let (a, b) = endpoints(g)?;
    let first = seg.points[0];
    let last = *seg.points.last()?;
    if (!seg.is_ring()
        && (!near(a, p(first.x as f64, first.y as f64))
            || !near(b, p(last.x as f64, last.y as f64))))
        || (seg.is_ring() && !near(a, b))
    {
        return None;
    }
    let mut cells: HashMap<(i32, i32), Vec<(PointF64, PointF64)>> = HashMap::new();
    for ps in seg.points.windows(2) {
        let a = p(ps[0].x as f64, ps[0].y as f64);
        let b = p(ps[1].x as f64, ps[1].y as f64);
        // PixelFitter coalesces straight runs; index their full extent too.
        for y in (a.y.min(b.y) / 2.).floor() as i32..=(a.y.max(b.y) / 2.).floor() as i32 {
            for x in (a.x.min(b.x) / 2.).floor() as i32..=(a.x.max(b.x) / 2.).floor() as i32 {
                cells.entry((x, y)).or_default().push((a, b));
            }
        }
    }
    if seg.is_ring() {
        let area = |ps: &[PointF64]| {
            ps.windows(2)
                .map(|w| w[0].x * w[1].y - w[1].x * w[0].y)
                .sum::<f64>()
        };
        let raw: Vec<_> = seg
            .points
            .iter()
            .map(|q| p(q.x as f64, q.y as f64))
            .collect();
        if area(&raw) * area(&flat) <= 0. {
            return None;
        }
    }
    let mut max: f64 = 0.;
    for q in flat {
        if !q.x.is_finite()
            || !q.y.is_finite()
            || q.x < 0.
            || q.y < 0.
            || q.x > w as f64
            || q.y > h as f64
        {
            return None;
        }
        let key = ((q.x / 2.).floor() as i32, (q.y / 2.).floor() as i32);
        let mut d = f64::INFINITY;
        for dy in -1..=1 {
            for dx in -1..=1 {
                if let Some(raw) = cells.get(&(key.0 + dx, key.1 + dy)) {
                    for &(a, b) in raw {
                        d = d.min(point_line(q, a, b));
                    }
                }
            }
        }
        max = max.max(d);
        if max > limit {
            return None;
        }
    }
    // Reverse direction: a fit must not shortcut away a thin lobe or corner.
    let mut fitted_cells: HashMap<(i32, i32), Vec<(PointF64, PointF64)>> = HashMap::new();
    for ps in flatten(g).windows(2) {
        for y in
            (ps[0].y.min(ps[1].y) / 2.).floor() as i32..=(ps[0].y.max(ps[1].y) / 2.).floor() as i32
        {
            for x in (ps[0].x.min(ps[1].x) / 2.).floor() as i32
                ..=(ps[0].x.max(ps[1].x) / 2.).floor() as i32
            {
                fitted_cells.entry((x, y)).or_default().push((ps[0], ps[1]));
            }
        }
    }
    for q in &seg.points {
        let q = p(q.x as f64, q.y as f64);
        let key = ((q.x / 2.).floor() as i32, (q.y / 2.).floor() as i32);
        let mut d = f64::INFINITY;
        for dy in -1..=1 {
            for dx in -1..=1 {
                if let Some(lines) = fitted_cells.get(&(key.0 + dx, key.1 + dy)) {
                    for &(a, b) in lines {
                        d = d.min(point_line(q, a, b));
                    }
                }
            }
        }
        max = max.max(d);
        if max > limit {
            return None;
        }
    }
    Some(max)
}
#[derive(Clone, Copy)]
struct Line {
    edge: usize,
    index: usize,
    a: PointF64,
    b: PointF64,
}
fn touches(a: Line, b: Line) -> bool {
    let ca = cross(a.a, a.b, b.a);
    let cb = cross(a.a, a.b, b.b);
    let cc = cross(b.a, b.b, a.a);
    let cd = cross(b.a, b.b, a.b);
    if ca * cb < -1e-16 && cc * cd < -1e-16 {
        return true;
    }
    for q in [a.a, a.b] {
        if point_line(q, b.a, b.b) < 1e-8 {
            return true;
        }
    }
    for q in [b.a, b.b] {
        if point_line(q, a.a, a.b) < 1e-8 {
            return true;
        }
    }
    false
}
fn collisions(graph: &BoundaryGraph, fitted: &[FittedSegment]) -> Result<HashSet<usize>, ()> {
    let mut lines: Vec<Line> = Vec::new();
    let mut cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    let mut bad = HashSet::new();
    let mut checks = 0;
    for (edge, f) in fitted.iter().enumerate() {
        let pts = flatten(&f.geom);
        if pts.len() > 32768 {
            return Err(());
        }
        for (index, ps) in pts.windows(2).enumerate() {
            if near(ps[0], ps[1]) {
                continue;
            }
            if lines.len() > 150000 {
                return Err(());
            }
            let l = Line {
                edge,
                index,
                a: ps[0],
                b: ps[1],
            };
            let x0 = (l.a.x.min(l.b.x) / 4.).floor() as i32;
            let x1 = (l.a.x.max(l.b.x) / 4.).floor() as i32;
            let y0 = (l.a.y.min(l.b.y) / 4.).floor() as i32;
            let y1 = (l.a.y.max(l.b.y) / 4.).floor() as i32;
            let mut seen = HashSet::new();
            for y in y0..=y1 {
                for x in x0..=x1 {
                    if let Some(ids) = cells.get(&(x, y)) {
                        for &id in ids {
                            if !seen.insert(id) {
                                continue;
                            }
                            checks += 1;
                            if checks > 2_000_000 {
                                return Err(());
                            }
                            let other = lines[id];
                            if edge == other.edge && index.abs_diff(other.index) <= 1 {
                                continue;
                            }
                            let common = [l.a, l.b]
                                .into_iter()
                                .find(|q| near(*q, other.a) || near(*q, other.b));
                            if let Some(q) = common {
                                let endpoints = |e: usize| {
                                    let s = &graph.segments[e];
                                    s.points
                                        .first()
                                        .into_iter()
                                        .chain(s.points.last())
                                        .any(|c| near(q, p(c.x as f64, c.y as f64)))
                                };
                                if (edge == other.edge
                                    && graph.segments[edge].is_ring()
                                    && index == pts.len() - 2
                                    && other.index == 0)
                                    || (edge != other.edge
                                        && endpoints(edge)
                                        && endpoints(other.edge))
                                {
                                    // Shared declared vertex is allowed, but not collinear overlap.
                                    let a = if near(q, l.a) { l.b } else { l.a };
                                    let b = if near(q, other.a) { other.b } else { other.a };
                                    if cross(q, a, b).abs() > 1e-9
                                        || (a.x - q.x) * (b.x - q.x) + (a.y - q.y) * (b.y - q.y)
                                            <= 0.
                                    {
                                        continue;
                                    }
                                }
                            }
                            if touches(l, other) {
                                bad.insert(edge);
                                bad.insert(other.edge);
                            }
                        }
                    }
                }
            }
            let id = lines.len();
            lines.push(l);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    cells.entry((x, y)).or_default().push(id);
                }
            }
        }
    }
    Ok(bad)
}

// Retry a rejected edge as bounded open pieces using the same upstream fitter.
// Pieces are joined in this single cache entry, never fitted per adjacent face.
fn constrained(
    seg: &mosaic::Segment,
    spline: &SplineSegmentFitter,
    w: u32,
    h: u32,
    depth: u8,
    candidate: Option<FittedSegment>,
) -> FittedSegment {
    let mut f = candidate.unwrap_or_else(|| {
        if seg.is_ring() {
            spline.fit_ring(seg)
        } else {
            spline.fit_open(seg)
        }
    });
    quantize(&mut f.geom);
    if drift(seg, &f.geom, w, h).is_some() {
        return f;
    }
    if seg.points.len() > 8 && depth < 8 {
        let mid = seg.points.len() / 2;
        let mut a = seg.clone();
        let mut b = seg.clone();
        a.points = seg.points[..=mid].to_vec();
        b.points = seg.points[mid..].to_vec();
        a.start = Some(0);
        a.end = Some(0);
        b.start = Some(0);
        b.end = Some(0);
        let mut curves = Vec::new();
        for piece in [
            constrained(&a, spline, w, h, depth + 1, None),
            constrained(&b, spline, w, h, depth + 1, None),
        ] {
            match piece.geom {
                FittedGeom::Beziers(cs) => curves.extend(cs),
                FittedGeom::Polyline(ps) => {
                    for pair in ps.windows(2) {
                        let a = pair[0];
                        let b = pair[1];
                        curves.push([
                            a,
                            p(a.x + (b.x - a.x) / 3., a.y + (b.y - a.y) / 3.),
                            p(a.x + 2. * (b.x - a.x) / 3., a.y + 2. * (b.y - a.y) / 3.),
                            b,
                        ]);
                    }
                }
            }
        }
        f.geom = FittedGeom::Beziers(curves);
        quantize(&mut f.geom);
        if drift(seg, &f.geom, w, h).is_some() {
            return f;
        }
    }
    let mut polygon = if seg.is_ring() {
        PolygonSegmentFitter.fit_ring(seg)
    } else {
        PolygonSegmentFitter.fit_open(seg)
    };
    quantize(&mut polygon.geom);
    if drift(seg, &polygon.geom, w, h).is_some() {
        polygon
    } else {
        PixelSegmentFitter.fit_open(seg)
    }
}

#[cfg(test)]
fn compose_map(map: &LabelMap) -> Result<(VectorDoc, Stats), String> {
    compose_map_mode(map, false, None, false)
}
pub fn compose_optimized(
    seg: &Segmentation,
    adaptive: bool,
    img: Option<&vtracer::ColorImage>,
    optimize: bool,
) -> Result<(VectorDoc, Stats), String> {
    let mut map = LabelMap::from_segmentation(seg);
    map.merge_similar(0);
    compose_map_mode(&map, adaptive, img, optimize)
}
fn compose_map_mode(
    map: &LabelMap,
    adaptive: bool,
    img: Option<&vtracer::ColorImage>,
    optimize: bool,
) -> Result<(VectorDoc, Stats), String> {
    crate::corners::reset();
    // Preflight before allocating graph/fitting. Source cap remains 2MP.
    let mut cracks = 0usize;
    for y in 0..map.height as i32 {
        for x in 0..map.width as i32 {
            let a = map.label(x, y);
            cracks += (a != map.label(x + 1, y)) as usize + (a != map.label(x, y + 1)) as usize;
            if x == 0 {
                cracks += (a != map.label(-1, y)) as usize;
            }
            if y == 0 {
                cracks += (a != map.label(x, -1)) as usize;
            }
        }
    }
    if cracks > 65536 {
        return Err("Shared-edge complexity exceeds 65536 cracks; choose the previous profile or a smaller input".into());
    }
    let graph = BoundaryGraph::extract(map);
    let faces = face::assemble(&graph, map);
    let mut stats = Stats {
        vertices: graph.nodes.len(),
        edges: graph.segments.len(),
        faces: faces.len(),
        ..Default::default()
    };
    let mut refs = vec![[0usize; 2]; graph.segments.len()];
    for f in &faces {
        for c in &f.contours {
            stats.contours += 1;
            for (i, r) in c.0.iter().enumerate() {
                let next = c.0[(i + 1) % c.0.len()];
                let s = &graph.segments[r.seg as usize];
                let t = &graph.segments[next.seg as usize];
                let end = if r.forward {
                    s.points.last()
                } else {
                    s.points.first()
                };
                let start = if next.forward {
                    t.points.first()
                } else {
                    t.points.last()
                };
                stats.incidence_errors += (end != start) as usize;
                let s = &graph.segments[r.seg as usize];
                let expected = if r.forward { s.left } else { s.right };
                stats.incidence_errors += (expected != f.region) as usize;
                refs[r.seg as usize][(!r.forward) as usize] += 1;
            }
        }
    }
    for (s, r) in graph.segments.iter().zip(refs) {
        stats.shared += (s.left != OUTSIDE && s.right != OUTSIDE) as usize;
        stats.incidence_errors += (r[0] != (s.left != OUTSIDE) as usize
            || r[1] != (s.right != OUTSIDE) as usize) as usize;
    }
    if stats.incidence_errors > 0 {
        return Err("Invalid shared-edge face incidence".into());
    }
    let spline = SplineSegmentFitter {
        length_threshold: 2.,
        ..Default::default()
    };
    let pixel = PixelSegmentFitter;
    let fit = |s: &mosaic::Segment, f: &dyn SegmentFitter| {
        if s.is_ring() {
            f.fit_ring(s)
        } else {
            f.fit_open(s)
        }
    };
    let mut fitted = Vec::new();
    for s in &graph.segments {
        let mut f = fit(s, &spline);
        quantize(&mut f.geom);
        if drift(s, &f.geom, map.width, map.height).is_none() {
            stats.repaired += 1;
            f = constrained(s, &spline, map.width, map.height, 0, Some(f));
        }
        fitted.push(f);
    }
    for attempt in 0..3 {
        match collisions(&graph, &fitted) {
            Ok(bad) if bad.is_empty() => break,
            result => {
                if attempt == 0 {
                    stats.crossings_before = result.as_ref().map_or(0, |b| b.len())
                }
                if result.is_err() {
                    stats.validation_budget_fallback = true;
                }
                if attempt == 2 || result.is_err() {
                    fitted = graph.segments.iter().map(|s| fit(s, &pixel)).collect();
                    stats.pixel_fallback = true;
                    break;
                }
                for id in result.unwrap() {
                    fitted[id] = fit(&graph.segments[id], &pixel);
                    stats.repaired += 1;
                }
            }
        }
    }
    // Raw pixel fallback is the original upstream integer planar graph.
    if !stats.pixel_fallback {
        stats.crossings_after = collisions(&graph, &fitted)
            .map_err(|_| "Topology validation budget exceeded")?
            .len();
    }
    if stats.crossings_after > 0 {
        return Err("Shared-edge intersection repair failed".into());
    }
    for (s, f) in graph.segments.iter().zip(&fitted) {
        stats.max_drift = stats.max_drift.max(
            drift(s, &f.geom, map.width, map.height)
                .ok_or("Shared-edge endpoint/drift validation failed")?,
        );
    }
    if adaptive {
        if let Some(img) = img {
            let baseline = fitted.clone();
            let mut changed = vec![false; fitted.len()];
            let mut sample_budget = 8192usize;
            if !stats.pixel_fallback && graph.segments.len() <= 256 {
                for (id, edge) in graph.segments.iter().enumerate() {
                    let proposal = crate::corners::fit(edge, id, Some(img));
                    let Some(samples) = crate::source_fit::samples(edge, map, img) else {
                        continue;
                    };
                    if samples.len() > sample_budget {
                        continue;
                    }
                    sample_budget -= samples.len();
                    let old_error =
                        crate::source_fit::error(&flatten(&baseline[id].geom), &samples);
                    let mut best_error = old_error;
                    let mut best = None;
                    for geom in [proposal, crate::source_fit::ellipse(edge, &samples)]
                        .into_iter()
                        .flatten()
                    {
                        let mut candidate = FittedSegment { geom };
                        quantize(&mut candidate.geom);
                        if drift_bounded(
                            edge,
                            &candidate.geom,
                            map.width,
                            map.height,
                            drift_limit(edge) + 0.5,
                        )
                        .is_none()
                        {
                            continue;
                        }
                        let e = crate::source_fit::error(&flatten(&candidate.geom), &samples);
                        if e + 0.00005 < old_error * 0.95 && e < 0.01 && e < best_error {
                            best_error = e;
                            best = Some(candidate)
                        }
                    }
                    if let Some(candidate) = best {
                        fitted[id] = candidate;
                        changed[id] = true
                    } else {
                        stats.adaptive_rollback = true;
                    }
                }
                for _ in 0..3 {
                    match collisions(&graph, &fitted) {
                        Ok(bad) if bad.is_empty() => break,
                        Ok(bad) => {
                            let mut repaired = false;
                            for id in bad {
                                if changed[id] {
                                    changed[id] = false;
                                    fitted[id] = baseline[id].clone();
                                    repaired = true;
                                    stats.adaptive_rollback = true;
                                }
                            }
                            if !repaired {
                                fitted = baseline.clone();
                                changed.fill(false);
                                break;
                            }
                        }
                        Err(_) => {
                            fitted = baseline.clone();
                            changed.fill(false);
                            stats.adaptive_rollback = true;
                            break;
                        }
                    }
                }
                if !matches!(collisions(&graph,&fitted),Ok(bad) if bad.is_empty()) {
                    fitted = baseline;
                    changed.fill(false);
                    stats.adaptive_rollback = true;
                }
                stats.source_accepted = changed.iter().filter(|&&v| v).count();
                stats.max_drift = 0.;
                for (id, (edge, fit)) in graph.segments.iter().zip(&fitted).enumerate() {
                    let limit = drift_limit(edge) + if changed[id] { 0.5 } else { 0. };
                    stats.max_drift = stats.max_drift.max(
                        drift_bounded(edge, &fit.geom, map.width, map.height, limit)
                            .ok_or("Source fit drift validation failed")?,
                    );
                }
            }
        }
    }
    if optimize && !stats.pixel_fallback {
        crate::reduce::timed(|| {
            let original = fitted.clone();
            let mut changed = vec![false; fitted.len()];
            for (id, edge) in graph.segments.iter().enumerate() {
                if let Some(g) = crate::reduce::propose(&fitted[id].geom, edge.is_ring()) {
                    let limit = drift_limit(edge).max(
                        drift_bounded(edge, &fitted[id].geom, map.width, map.height, 1.5)
                            .unwrap_or(0.),
                    );
                    if drift_bounded(edge, &g, map.width, map.height, limit).is_some() {
                        fitted[id].geom = g;
                        changed[id] = true;
                    }
                }
            }
            match collisions(&graph, &fitted) {
                Ok(bad) => {
                    for id in bad {
                        if changed[id] {
                            fitted[id] = original[id].clone();
                            changed[id] = false;
                        }
                    }
                }
                Err(_) => {
                    fitted = original.clone();
                    changed.fill(false);
                }
            }
            if !matches!(collisions(&graph,&fitted),Ok(bad) if bad.is_empty()) {
                fitted = original.clone();
                changed.fill(false);
            }
            stats.max_drift = 0.;
            for (id, edge) in graph.segments.iter().enumerate() {
                if changed[id] {
                    crate::reduce::accepted(&original[id].geom, &fitted[id].geom);
                }
                stats.max_drift = stats.max_drift.max(
                    drift_bounded(edge, &fitted[id].geom, map.width, map.height, 1.5).unwrap_or(0.),
                );
            }
        });
    }
    if optimize {
        stats.max_drift = 0.;
        for (edge, fit) in graph.segments.iter().zip(&fitted) {
            stats.max_drift = stats.max_drift.max(
                drift_bounded(edge, &fit.geom, map.width, map.height, 1.5)
                    .ok_or("Optimized shared edge drift invalid")?,
            );
        }
    }
    // No independent simplification/refinement/rounding after this composition.
    Ok((mosaic::compose_fitted(map, &graph, &faces, &fitted), stats))
}

#[cfg(test)]
mod tests {
    use super::*;
    use vtracer::{
        Color,
        ir::{Paint, PathCmd},
    };
    fn map(w: u32, h: u32, labels: Vec<u32>) -> LabelMap {
        LabelMap {
            width: w,
            height: h,
            labels,
            paints: vec![
                Paint::Solid(Color::new(255, 0, 0)),
                Paint::Solid(Color::new(0, 0, 255)),
                Paint::Solid(Color::new(0, 255, 0)),
            ],
        }
    }
    #[test]
    fn junction_holes_islands_and_diagonal_contacts() {
        for m in [
            map(2, 2, vec![0, 0, 1, 2]),
            map(2, 2, vec![0, 1, 1, 0]),
            map(3, 3, vec![0, 0, 0, 0, OUTSIDE, 0, 0, 0, 0]),
            map(3, 2, vec![0, 1, 0, 0, 1, 0]),
        ] {
            let (doc, s) = compose_map(&m).unwrap();
            assert_eq!(s.incidence_errors, 0);
            assert_eq!(s.crossings_after, 0);
            for shape in doc.shapes {
                for sub in shape.path.subpaths {
                    assert_eq!(sub.commands.last(), Some(&PathCmd::Close));
                }
            }
        }
    }
    #[test]
    fn invalid_fit_and_excessive_graph_are_rejected() {
        let m = map(2, 2, vec![0, 0, 1, 2]);
        let g = BoundaryGraph::extract(&m);
        let s = &g.segments[0];
        assert!(drift(s, &FittedGeom::Polyline(vec![p(-1., -1.), p(3., 3.)]), 2, 2).is_none());
        let labels = (0..256 * 256)
            .map(|i| ((i % 256 + i / 256) % 2) as u32)
            .collect();
        assert!(
            compose_map(&map(256, 256, labels))
                .unwrap_err()
                .contains("complexity")
        );
    }
    #[test]
    fn crossing_curves_are_detected() {
        let m = map(2, 2, vec![0, 0, 1, 2]);
        let g = BoundaryGraph::extract(&m);
        let mut f: Vec<_> = g
            .segments
            .iter()
            .map(|s| PixelSegmentFitter.fit_open(s))
            .collect();
        f[0].geom = FittedGeom::Polyline(vec![p(0., 0.), p(2., 2.)]);
        f[1].geom = FittedGeom::Polyline(vec![p(0., 2.), p(2., 0.)]);
        assert!(!collisions(&g, &f).unwrap().is_empty());
    }
    #[test]
    fn closed_curved_partition_keeps_shared_edges() {
        let mut labels = vec![];
        for y in 0..32 {
            for x in 0..32 {
                labels.push(if (x as f64 - 15.5).hypot(y as f64 - 15.5) < 11. {
                    1
                } else {
                    0
                });
            }
        }
        let (doc, s) = compose_map(&map(32, 32, labels)).unwrap();
        assert_eq!(s.shared, 1);
        assert_eq!(s.faces, 2);
        assert!(s.max_drift <= 1.0);
        // Every drawing primitive on the inner boundary has an exact reverse.
        let mut all = vec![];
        for sh in &doc.shapes {
            for sub in &sh.path.subpaths {
                let mut a = p(0., 0.);
                for cmd in &sub.commands {
                    match *cmd {
                        PathCmd::MoveTo(q) => a = q,
                        PathCmd::LineTo(b) => {
                            all.push([a, a, b, b]);
                            a = b
                        }
                        PathCmd::CubicTo(b, c, d) => {
                            all.push([a, b, c, d]);
                            a = d
                        }
                        _ => {}
                    }
                }
            }
        }
        let paired = all
            .iter()
            .filter(|c| all.iter().any(|d| **c == [d[3], d[2], d[1], d[0]]))
            .count();
        assert!(paired > 8);
    }
}
