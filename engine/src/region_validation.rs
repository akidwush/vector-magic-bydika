//! Final-document rollback, reusing the existing Green integral and flattener.
//! There is at most one immutable baseline replay per changed image, never a
//! rerender per merge. Actual browser/libvips export gates remain independent.
use std::cell::{Cell, RefCell};
use vtracer::{
    ColorImage, Config,
    ir::{PathCmd, VectorDoc},
};
thread_local! {
 static CAPTURE:Cell<bool>=const{Cell::new(false)};
 static DOC:RefCell<Option<VectorDoc>>=const{RefCell::new(None)};
 static FAILURE:RefCell<String>=const{RefCell::new(String::new())};
 static REPORT:RefCell<String>=const{RefCell::new(String::new())};
}
pub fn report() -> String {
    REPORT.with(|s| s.borrow().clone())
}
pub fn record(doc: &VectorDoc) {
    if CAPTURE.with(Cell::get) {
        DOC.with(|s| *s.borrow_mut() = Some(doc.clone()));
    }
}
fn take() -> Option<VectorDoc> {
    DOC.with(|s| s.borrow_mut().take())
}
struct Reset(u32);
impl Drop for Reset {
    fn drop(&mut self) {
        vtracer::region_research::configure(self.0);
        CAPTURE.with(|s| s.set(false));
        DOC.with(|s| s.borrow_mut().take());
    }
}
pub fn run(
    config: Config,
    rgba: Vec<u8>,
    w: usize,
    h: usize,
    profile: &str,
) -> Result<String, wasm_bindgen::JsValue> {
    let mode = vtracer::region_research::mode();
    REPORT.with(|s| s.borrow_mut().clear());
    if mode == 0 {
        return super::run_pipeline_once(config, rgba, w, h, profile);
    }
    let img = ColorImage {
        pixels: rgba.clone(),
        width: w,
        height: h,
    };
    if !vtracer::region_research::eligible(&img) {
        return super::run_pipeline_once(config, rgba, w, h, profile);
    }
    let _reset = Reset(mode);
    CAPTURE.with(|s| s.set(true));
    let t = super::now();
    let candidate = super::run_pipeline_once(config.clone(), rgba.clone(), w, h, profile)?;
    let candidate_ms = super::now() - t;
    let cd = take();
    let evidence = vtracer::region_research::report();
    if !vtracer::region_research::changed() {
        REPORT.with(|s|*s.borrow_mut()=format!("{{\"verdict\":\"UNCHANGED\",\"candidateMs\":{candidate_ms},\"evidence\":{evidence}}}"));
        return Ok(candidate);
    }
    let captured = vtracer::thin::take_snapshot();
    vtracer::region_research::configure(0);
    let t = super::now();
    let baseline = super::run_pipeline_once(config, rgba, w, h, profile)?;
    let baseline_ms = super::now() - t;
    let bd = take();
    vtracer::thin::restore_snapshot(captured);
    let t = super::now();
    FAILURE.with(|s| s.borrow_mut().clear());
    let result = bd.zip(cd).and_then(|(b, c)| compare(&b, &c, &img));
    let accepted = result.as_ref().is_some_and(|r| r.accepted);
    let detail=result.map(|r|format!("{{\"baselineMAE\":{},\"candidateMAE\":{},\"changedTiles\":{},\"worseTiles\":{},\"samples\":{}}}",r.before,r.after,r.changed,r.worse,r.samples)).unwrap_or_else(||format!("{{\"rejected\":\"{}\"}}",FAILURE.with(|s|s.borrow().clone())));
    let ms = super::now() - t;
    REPORT.with(|s|*s.borrow_mut()=format!("{{\"verdict\":\"{}\",\"candidateMs\":{candidate_ms},\"baselineReplayMs\":{baseline_ms},\"validationMs\":{ms},\"paint\":{detail},\"evidence\":{evidence}}}",if accepted{"ACCEPTED"}else{"ROLLBACK"}));
    Ok(if accepted { candidate } else { baseline })
}
struct Comparison {
    accepted: bool,
    before: f64,
    after: f64,
    changed: usize,
    worse: usize,
    samples: usize,
}
fn command_count(d: &VectorDoc) -> usize {
    d.shapes
        .iter()
        .flat_map(|s| &s.path.subpaths)
        .map(|s| s.commands.len())
        .sum()
}
fn fail(reason: String) -> Option<Vec<[f64; 4]>> {
    FAILURE.with(|s| *s.borrow_mut() = reason);
    None
}
// The existing fitter flattener has a per-curve-model cap of8192. A compound
// SVG path can contain many such fitted models. Reuse it in fixed64-cubic
// chunks, preserving subdivision and summation order; total remains capped.
fn flatten_path(g:&vtracer::mosaic::FittedGeom)->Option<Vec<vtracer::PointF64>>{
    use vtracer::mosaic::FittedGeom as G;
    match g{G::Polyline(_)=>super::inverse::flatten(g,0.001),G::Beziers(cs)=>{
        let mut out=Vec::new();for chunk in cs.chunks(64){let ps=super::inverse::flatten(&G::Beziers(chunk.to_vec()),0.001)?;
            let skip=usize::from(!out.is_empty());out.extend(ps.into_iter().skip(skip));if out.len()>65_536{return None;}
        }Some(out)
    }}
}
fn render(d: &VectorDoc, img: &ColorImage) -> Option<Vec<[f64; 4]>> {
    // Full image <=512², but only samples inside each shape's bbox enter the
    // established analytical integral. Caps are fail-closed, no approximate score.
    if d.shapes.len() > 128 || command_count(d) > 16_384 {
        return fail(format!(
            "DOCUMENT_BUDGET:{}:{}",
            d.shapes.len(),
            command_count(d)
        ));
    }
    let n = img.width * img.height;
    let mut out = vec![[0.; 4]; n];
    let mut total_edges = 0;
    let mut total_samples = 0;
    let mut integral_work = 0usize;
    for shape in &d.shapes {
        let mut polys = Vec::new();
        let mut bb = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for sub in &shape.path.subpaths {
            if sub.commands.last() != Some(&PathCmd::Close) {
                return fail("OPEN_SUBPATH".into());
            }
            let model=super::source_fit::from_path(sub).or_else(||{FAILURE.with(|s|*s.borrow_mut()="INVALID_SUBPATH".into());None})?;
            let poly=flatten_path(&model).or_else(||{FAILURE.with(|s|*s.borrow_mut()="VALIDATION_FLATTEN_LIMIT".into());None})?;
            total_edges += poly.len();
            if total_edges > 65_536 {
                return fail(format!("FLATTEN_BUDGET:{total_edges}"));
            }
            for p in &poly {
                bb[0] = bb[0].min(p.x);
                bb[1] = bb[1].min(p.y);
                bb[2] = bb[2].max(p.x);
                bb[3] = bb[3].max(p.y);
            }
            polys.push(poly);
        }
        let x0 = bb[0].floor().max(0.) as usize;
        let y0 = bb[1].floor().max(0.) as usize;
        let x1 = bb[2].ceil().min(img.width as f64) as usize;
        let y1 = bb[3].ceil().min(img.height as f64) as usize;
        let rows: usize = polys
            .iter()
            .flat_map(|p| p.windows(2))
            .map(|e| (e[1].y.max(e[0].y).ceil() - e[1].y.min(e[0].y).floor()).max(0.) as usize)
            .sum();
        integral_work = integral_work.checked_add(rows.checked_mul(x1.saturating_sub(x0))?)?;
        if integral_work > 16_000_000 {
            return fail(format!("GREEN_WORK_BUDGET:{integral_work}"));
        }
        let ss: Vec<_> = (y0..y1)
            .flat_map(|y| {
                (x0..x1).map(move |x| super::source_fit::Sample {
                    x: x as i32,
                    y: y as i32,
                    coverage: 0.,
                    trusted: false,
                })
            })
            .collect();
        total_samples += ss.len();
        if total_samples > 2_000_000 {
            return fail(format!("SAMPLE_BUDGET:{total_samples}"));
        }
        let mut area = vec![0.; ss.len()];
        for poly in polys {
            for (a, v) in
                area.iter_mut()
                    .zip(super::inverse::signed_edge_areas(&poly, &ss).or_else(|| {
                        FAILURE.with(|s| *s.borrow_mut() = "GREEN_EDGE_ROW_BUDGET".into());
                        None
                    })?)
            {
                *a += v;
            }
        }
        let c = shape.paint.color();
        let color = [c.r as f64, c.g as f64, c.b as f64];
        for (s, v) in ss.iter().zip(area) {
            let alpha = v.abs().clamp(0., 1.);
            let p = &mut out[s.y as usize * img.width + s.x as usize];
            for k in 0..3 {
                p[k] = color[k] * alpha + p[k] * (1. - alpha);
            }
            p[3] = 255. * alpha + p[3] * (1. - alpha);
        }
    }
    Some(out)
}
fn compare(b: &VectorDoc, c: &VectorDoc, img: &ColorImage) -> Option<Comparison> {
    if c.shapes.len() > b.shapes.len() + 24 || command_count(c) > command_count(b) * 2 + 128 {
        return None;
    }
    let a = render(b, img)?;
    let z = render(c, img)?;
    let (w, h) = (img.width, img.height);
    let mut before = 0.;
    let mut after = 0.;
    let mut changed = 0;
    let mut worse = 0;
    // Complete output plus fixed8x8 local tiles: no full-image mean can hide a
    // damaged edited neighborhood. Same unchanged tile is never evidence of repair.
    for y0 in (0..h).step_by(8) {
        for x0 in (0..w).step_by(8) {
            let mut old = 0.;
            let mut new = 0.;
            let mut delta = 0.;
            for y in y0..(y0 + 8).min(h) {
                for x in x0..(x0 + 8).min(w) {
                    let i = y * w + x;
                    for k in 0..4 {
                        let source = img.pixels[i * 4 + k] as f64;
                        old += (a[i][k] - source).abs();
                        new += (z[i][k] - source).abs();
                        delta += (a[i][k] - z[i][k]).abs();
                    }
                }
            }
            before += old;
            after += new;
            if delta > 0.01 {
                changed += 1;
                if new > old + 1e-6 {
                    worse += 1;
                }
            }
        }
    }
    let divisor = (w * h * 4) as f64;
    Some(Comparison {
        accepted: changed > 0 && worse == 0 && after + 1e-6 < before,
        before: before / divisor,
        after: after / divisor,
        changed,
        worse,
        samples: w * h,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use vtracer::{
        PointF64,
        ir::{MultiPath, Paint, Shape, SubPath},
    };
    fn rect(x: f64, y: f64, w: f64, h: f64, c: u8) -> Shape {
        let p = |x, y| PointF64 { x, y };
        Shape {
            paint: Paint::Solid(vtracer::Color::new(c, c, c)),
            path: MultiPath {
                subpaths: vec![SubPath {
                    commands: vec![
                        PathCmd::MoveTo(p(x, y)),
                        PathCmd::LineTo(p(x + w, y)),
                        PathCmd::LineTo(p(x + w, y + h)),
                        PathCmd::LineTo(p(x, y + h)),
                        PathCmd::Close,
                    ],
                }],
            },
        }
    }
    fn scene(c: u8) -> (VectorDoc, ColorImage) {
        let mut d = VectorDoc::new(16, 16);
        d.shapes.push(rect(0., 0., 16., 16., c));
        let i = ColorImage {
            width: 16,
            height: 16,
            pixels: (0..256).flat_map(|_| [252, 252, 252, 255]).collect(),
        };
        (d, i)
    }
    #[test]
    fn exact_green_paint_improvement_passes() {
        let (b, i) = scene(240);
        let (c, _) = scene(252);
        let r = compare(&b, &c, &i).unwrap();
        assert!(r.accepted);
        assert_eq!(r.after, 0.);
        assert_eq!(r.samples, 256);
    }
    #[test]
    fn local_damage_is_not_hidden_by_global_gain() {
        let (b, i) = scene(240);
        let (mut c, _) = scene(252);
        c.shapes.push(rect(0., 0., 2., 2., 0));
        let r = compare(&b, &c, &i).unwrap();
        assert!(r.after < r.before);
        assert!(!r.accepted);
        assert_eq!(r.worse, 1);
    }
    #[test]
    fn open_output_fails_closed() {
        let (mut d, i) = scene(252);
        d.shapes[0].path.subpaths[0].commands.pop();
        assert!(render(&d, &i).is_none());
    }
    #[test]
    fn no_repair_claim_for_identical_document() {
        let (d, i) = scene(252);
        let r = compare(&d, &d, &i).unwrap();
        assert!(!r.accepted);
        assert_eq!(r.changed, 0);
    }
    #[test]
    fn pathological_shape_count_fails_closed() {
        let (mut d, i) = scene(252);
        d.shapes = vec![rect(0., 0., 1., 1., 252); 129];
        assert!(render(&d, &i).is_none());
    }
}
