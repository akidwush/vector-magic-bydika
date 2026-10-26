# Stage 1.6B recovery — output-consistent source geometry

**Recovery gate: PASS locally and in GitHub CI. Research feature only; no merge or global enablement.**
The broader Stage 1.6 goal of 1/16–1/64px absolute reconstruction remains
**PARTIAL**, including on these fixtures. Numerical coverage precision is not
boundary accuracy or evidence of Vector Magic equivalence.

Implementation: [`e482595f595a9a20678690614af389a91255050b`](https://github.com/akidwush/vector-magic-bydika/commit/e482595f595a9a20678690614af389a91255050b)
on `feat/stage-1-6b-recovery`.
Predecessor: rejected Stage 1.6B `c30e0ebe223597f1aa3f55b8fa813c7b33bec85a`.
Stage 1.6 comparator: `db06a032f7180f349b275ef3801854c048bb674d`.
Stage 1.5 production comparator: `6084faffbd18313c80b7d4bc8bec349dd88b63c8`.
Measurements below were obtained locally on 2026-10-26 using the actual WASM,
original PNGs and exported SVGs. CI status is recorded separately below.

## Confirmed causes and rejected predecessor

1. **Acute wedges are not half-planes.** Both sides of the cubic tip contribute
   area to the same pixels. Inverting their coverage as one boundary biases the
   normal target inward. Reliable two-color unmixing alone cannot detect this.
2. **Intermediate knots are not exported corners.** The old solver ran before
   reduction; tiny corner splices were optimized and then simplified differently.
   Cubic grew from 73 to 76 anchors and Wave from 57 to 61. Protected candidates
   did not correspond one-to-one to the serialized apex.
3. **A whole-ring solve redistributes residuals.** Wave's accurate vertical side
   and its first junction absorbed errors from curved spans. Lower aggregate
   coverage loss hid a worse mean/reference distance and worse rendered MAE.

The previous candidate reduced Cubic mean to 0.053294px, but maximum rose from
1.561513 to 1.966913px and corner recall fell to 0.667. Wave maximum improved to
0.724224px, but mean rose to 0.083441px and libvips MAE to 0.541106. That candidate
remains rejected; its historical report and source are retained at `c30e0eb`.

## Architecture and reused components

VTracer is still the tracer: 1.0.0-alpha.4, pinned upstream
`e71343fbcbf469b8a72a255030408a39939162eb`; visioncortex 0.9.3 and flo_curves 0.8.0
remain unchanged. Licenses and attribution are unchanged. There is no new
segmentation engine, planar graph, rasterizer dependency, model or service.

The implementation reuses `source_fit::Sample`, VTracer `FittedGeom`/`SubPath`,
the existing calibrated unmixing and validated signed-offset helper, and the
Stage 1.6 continuous Green-integral polygon coverage evaluator. The old dense
whole-ring target solver was removed, not layered under another solver.

The order for an eligible stacked source contour is now:

```text
VTracer → existing Stage 1.5 source fit / protection
        → inverse repair / unique document ownership
        → existing coverage + quantization + conservative node reduction
        → source geometry recovery on reduced knots
        → exact line serialization → SVG writer
```

Matching is unique before reduction; stable shape/subpath indices carry ownership
through the reducer. Ambiguous matches skip recovery. A tentative tiny-splice
canonicalization happens before the span solve, followed by source validation.
There is no reduction after recovery. A final apex-only validation may change
coordinates, but cannot collapse or insert a segment. The final knot count must
not exceed the reduced baseline; SVG writes at six-place precision with geometry
quantized to four places. The node reducer's 0.12px validation is unchanged.

Eligibility remains conservative: supported, owned, closed opaque two-color
components, decisive gamma evidence and small color residuals. Open/junction
chains, partial alpha, unsupported ownership and uncertain gamma keep the
previous geometry. The document must have at most 64 shapes and 65536 commands;
only up to four captured components and 5–128 reduced cubics per component are
considered. Colors are never merged to create eligibility.

## Wedge exclusion and source-calibrated corners

A 4px spatial index contains tessellated final curves, expanded by 2.5px.
Transition pixels are excluded from half-plane inversion when another nearby
nonadjacent piece has a sufficiently different outward normal (dot < 0.75,
distance < 2.25px), or when the pixel falls inside a detected G0 corner's
`clamp(1.25/sin(interior_angle/2), 2.25, 6)` exclusion radius. Opposite sides in
a 3×3 neighborhood are conservatively covered by this distance/normal test.
Stable single-edge orientation, trusted ownership and the existing coverage
inversion are still required elsewhere. Samples do not become SVG anchors.

Tiny splices require length <2.25px or close endpoints <3px with combined
adjacent turn >35°. Incoming/outgoing tangent intersection supplies one explicit
G0 vertex. It is accepted together with source-verified apex adjustment, never
merely because the segment is short. Smooth short arcs are retained.

Arm evidence is sampled outside the wedge, from approximately `R_wedge+1` to
16px of arclength. Opposite-arm pixels are rejected. Deterministic PCA tangent
calibration uses ordered original-raster samples; uncertain arms receive lower
weight. Axis-aligned supported arms retain their exact tangent.

At a supported acute corner the two calibrated tangent lines solve:

```text
min_C  w_in [n_in·(C-P_in)]² + w_out [n_out·(C-P_out)]²
       + 1e-5 ||C-C_initial||²
```

The regularized 2×2 intersection has determinant and displacement guards.
A bounded coordinate search then compares full 2D region coverage in a dense
5×5 source patch: apex movement stays within 1.25px of the intersection;
only incident handle length/direction changes are considered. The original
final-output G0 turn is protected by a ±0.35-radian angle prior. This conservative
prior prevents introducing a new acute turn, and also limits complete tangent
recovery in uncertain junctions. Unsupported/nonacute corners remain locked.

Acceptance requires strictly lower local coverage MSE and nonincreasing local
rendered-paint RGB error. Both the original wedge and unchanged curve
contributions are included; no half-plane targets guide the apex patch.

## Partitioned fitting and rollback

Contours are partitioned at final G0 vertices. A smooth closed ring gets a fixed
virtual seam. Each smooth span has its own regularized, banded normal system;
G0 endpoints do not transmit displacement into another span. Coupled knot and
incident-handle translations preserve existing smooth tangent rays.

The least-squares surrogate contains normal target residuals, a 0.01 displacement
prior and 0.02 neighboring-displacement regularization. Spans are ranked by p95
plus maximum target residual. Mean <0.035px and max <0.15px skips an already
accurate span. At most four spans, three iterations and three backtracking scales
are evaluated; movement <0.005px or no improvement terminates early.

Axis-aligned collinear edges and their adjacent knots are locked during curved
span solving. Separate axis calibration permits normal-only movement when its
median supported offset exceeds 0.05px; exact 0°/90° tangents are retained.
The long axis edges of both primary fixtures needed no normal update.

Each proposed span must improve local bbox/band coverage MSE **and** not increase
local RGB L1 reconstruction. A failed span rolls back independently. Original
source A/B colors and gamma estimate coverage; actual quantized SVG foreground
and dominant surrounding paint colors predict export RGB. These are separate
models: source white and exported #fefefe are not silently treated as identical.
For this opaque route alpha is always one, so this RGB comparison is proportional
to premultiplied RGBA MAE. Independent renderers validate the exported result.

Per-step knot displacement is limited to 0.4px, per-span control displacement to
1.25px. Final source-evidenced geometry has a separate two-sided 3.5px baseline
trust region, with no change to existing node reduction or raw-mask guards.
Closure, finite bounds, winding, containment, sampled self-crossings and existing
`planar::replacement_clear` checks must all pass. Whole-component source and
paint error are checked again after quantization; otherwise the old reduced
geometry is restored.

Shared-edge/planar composition does not run this independent stacked recovery.
Its existing once-fitted edge cache and exact reversed geometry remain intact.
There is no independent per-face adjustment after graph assembly.

## Actual three-build export benchmark

All variants use the original 1024px PNG, Illustration preset, VTracer WASM and
`inverse-reduce-reconstruct`. The runner builds both comparator commits in
isolated temporary worktrees, downloads actual SVG blobs, and measures them
against retained legal vector ground truth. No fixture names are used in the
engine. Existing gate thresholds and metric code were not changed.

| Fixture / build | Mean px | p95 px | Sampled max px | Corner precision / recall | Anchors | Cubics | Paths | SVG bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Cubic / Stage 1.5 | 0.091762 | 0.371053 | 1.561513 | 1 / 1 | 73 | 66 | 2 | 2179 |
| Cubic / Stage 1.6 | 0.091762 | 0.371053 | 1.561513 | 1 / 1 | 73 | 66 | 2 | 2179 |
| Cubic / recovery | 0.046768 | 0.198287 | 0.702885 | 1 / 1 | 72 | 65 | 2 | 2735 |
| Wave / Stage 1.5 | 0.079448 | 0.298474 | 1.000000 | 1 / 1 | 57 | 50 | 2 | 1839 |
| Wave / Stage 1.6 | 0.079448 | 0.298474 | 1.000000 | 1 / 1 | 57 | 50 | 2 | 1839 |
| Wave / recovery | 0.058444 | 0.238860 | 0.660000 | 1 / 1 | 57 | 50 | 2 | 2309 |

Cubic improves mean 49.0%, p95 46.6%, sampled maximum 55.0%; Wave improves
26.4%, 20.0% and 34.0%. Both have zero proper sampled crossings, two closed paths,
no new acute turns, and zero new holes. Smooth-join maximum angle is
0.007977→0.006583 radians for Cubic and 0.006888→0.006888 for Wave.

**Endpoint-inclusive cross-check:** the historical Chromium reference sampler
samples near the true tip rather than exactly at it. The independent probe
includes exact reference endpoints. Cubic maximum there is
1.625054→0.766976px; the final actual corner is (927.8522,320.7526) against
(928,320). Wave's corner is (64,512.66), 0.66px from (64,512), down from 1px.
Both samplers improve; neither is an analytic Hausdorff certificate.

| Fixture / build | RGBA MAE libvips | RGBA MAE Chromium | Silhouette IoU libvips | IoU Chromium | Trace ms |
|---|---:|---:|---:|---:|---:|
| Cubic / Stage 1.5 | 0.540209 | 0.543315 | 0.999281 | 0.999186 | 699.1 |
| Cubic / Stage 1.6 | 0.540209 | 0.543315 | 0.999281 | 0.999186 | 714.4 |
| Cubic / recovery | 0.528289 | 0.530567 | 0.999596 | 0.999553 | 851.3 |
| Wave / Stage 1.5 | 0.539178 | 0.541712 | 0.999274 | 0.999274 | 535.3 |
| Wave / Stage 1.6 | 0.539178 | 0.541712 | 0.999274 | 0.999274 | 567.0 |
| Wave / recovery | 0.531787 | 0.533414 | 0.999504 | 0.999443 | 670.1 |

MAE uses the existing 0–255 premultiplied metric. Higher IoU does not prove
precise corner recovery; the boundary and endpoint checks remain mandatory.
**SVG bytes increase about 25.5%** from additional fractional coordinates despite
stable/reduced nodes. This is a geometry recovery result, not a file compression
improvement. No coordinate precision was discarded to hide that cost.

### Cross-resolution probe, including exact reference endpoints

| Fixture | Baseline mean / p95 / max px | Recovery mean / p95 / max px | Decision |
|---|---:|---:|---|
| Cubic 128 | 0.122940 / 0.354277 / 3.474265 | identical | unsupported prior source initialization; unchanged |
| Cubic 512 | 0.104745 / 0.396321 / 3.474265 | identical | unsupported prior source initialization; unchanged |
| Wave 128 | 0.128942 / 0.426717 / 1.569711 | identical | unsupported prior source initialization; unchanged |
| Wave 512 | 0.087896 / 0.296898 / 1.000000 | 0.074254 / 0.237143 / 0.578088 | accepted |
| Cubic 1024 | 0.093364 / 0.374901 / 1.625054 | 0.047432 / 0.200903 / 0.766976 | accepted |
| Wave 1024 | 0.080852 / 0.301974 / 1.000000 | 0.059089 / 0.241311 / 0.660000 | accepted |

The unsupported cases report zero accepted inverse initialization and zero
recovery components; this phase deliberately cannot bypass missing trusted
initialization. Cubic 128/512 still have a large error. This is an unresolved
quality limitation, not a PASS for low-resolution recovery.

## Cost, profiling and coverage precision

| Fixture | New recovery ms | Span solve/index ms | Axis/corner ms | Coverage evaluations | Trusted observations / wedge exclusions | Collapsed splices / apex updates |
|---|---:|---:|---:|---:|---:|---:|
| Cubic 1024 | 124.7 | 71.3 | 20.7 | 215 | 2850 / 45 | 1 / 2 |
| Wave 1024 | 133.1 | 68.9 | 25.2 | 243 | 4003 / 15 | 0 / 1 |

Original-source coverage MSE on the retained sample band, evaluated after
reduction, changes 0.00584651→0.00195843 for Cubic and
0.00484606→0.00281755 for Wave. This local/sample loss is not a substitute for
the exported full-image and absolute boundary metrics above.

The remaining time covers final safety/whole-component scoring and ownership.
Target observations count reused samples across iterations; they are not unique
source pixels. Existing Stage 1.5 fitting and inverse scoring remain separate;
`last_recovery` and adapter `sourceGeometry` expose the added work. Relative to
the Stage 1.6 comparator, tracing rises 19.2%/18.2%, within the unchanged 50% cap.
These are local desktop observations, not Android-device measurements.
WASM cold initialization is recorded separately (8.5ms candidate on the first
fixture); subsequent module reuse reports effectively zero initialization.
Browser tests also exercise warm worker reuse, cancel, replacement and reset.

Profiling identified repeated whole-contour flattening for corner trials as
avoidable cost. The patch evaluator caches unchanged **signed** Green-integral
contributions and re-flattens only the two incident cubics at 0.001px tolerance.
Abs/clamp happens only after all contributions are summed. Native tests verify
cache/full evaluator agreement, both winding orientations and both source gamma
models. The validated continuous coverage formula was reused, not replaced.

Other limits: 8192 source samples/raw contour points, 16384 target pieces,
65536 grid entries, two million proximity checks, at most 256 scalar variables,
three span iterations and bounded apex searches with early termination.
The normal matrix is allocated densely (at most about 0.5MiB); banded elimination
avoids dense whole-ring solve cost. Grid/context/geometry allocations are also
capped. Total peak RSS/WASM memory has **not** been measured. Cancellation still
terminates the worker; no external processing is introduced.

Coverage regression retains the existing curved-pixel reference: final polygon
estimate 0.599938966 versus exact 0.6 and independent high-density libvips
0.599832871. This validates integration convergence, not 1/64px shape recovery.

## Experiments and limits of acceptance

- Previous pre-reduction whole-ring translation, opposing-edge-only exclusion,
  normal-handle fitting and intermediate corner protection: rejected; they did
  not jointly preserve maximum error, corner recall, reconstruction and speed.
- First output-topology recovery reduced geometric error, but unrestricted
  calibrated tangent rotation introduced an extra acute Wave turn. Rejected.
  A final-output angle consistency prior now constrains the uncertain junction.
- Re-flattening the full ring for every apex coordinate trial improved geometry
  but cost too much. Replaced by the mathematically equivalent signed-area cache.
- Using source palette colors as exported colors can make local RGB rollback
  incorrect. Source unmixing and actual document paints are now scored separately.
- The retained candidate passes the immutable primary recovery gate. The maximum
  remains 0.767px at the actual cubic endpoint; no universal subpixel accuracy,
  exact original-shape recovery or commercial parity is claimed.
- The additional alpha research sweep still rejects the old spline-only 128px
  experiment: IoU 0.978553 is below 0.980. The production polygon alpha route
  remains at 0.983604; the high-node pixel alternative is not promoted merely
  because its IoU is higher. These experimental variants are not all marked PASS.

New native cases cover unique ownership/reset, ambiguous alpha/third colors,
additive signed coverage caching, positive/singular banded solves, opposing arms,
short smooth segments, bevel collapse, axis-only movement, dense wedge recovery,
no added knots and invalid crossings. Regression export comparisons cover all
35 existing source cases, including circles, ellipses, sharp polygons, hair,
cat features, thin details, JPEG/WebP, partial alpha and shared edges.

Partial-alpha 128 IoU remains 0.983604 (>0.980), with no hole. Shared organic/thin
planar and intelligent modes retain exact coincidence 1.0, unmatched edges 0,
geometric gap samples 0 and overlap samples 0. Renderer antialias seam pixels
still exist on coincident boundaries; this recovery does not claim to eliminate
renderer compositing seams. Inkscape 1.4 CLI plain-SVG/PNG roundtrips pass on four
actual candidate exports, with unchanged editable anchors. GUI anchor editing
and Illustrator are unverified.

## Verification and GitHub

All mandatory commands completed successfully locally:

```sh
./scripts/build-wasm.sh
cargo test --manifest-path engine/Cargo.toml --locked
cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
npm test && npm run lint && npm run typecheck && npm run build
npm run test:e2e
bash scripts/source-target-research.sh
```

Results: 51 native tests in each configuration, 31 upstream tests, 37 TypeScript
tests, all 22 default and all 22 feature-enabled browser tests. The research
runner separately reruns three targeted feature browser tests, all 35 export
comparisons, Inkscape checks when installed, the Stage 1.5 retention gate,
Stage 1.6 proof and unchanged Stage 1.6B gate. Final gate JSON is
`{"status":"PASS","failures":[]}`. Stage 1.6 proof still records the failed
1/16–1/64px research targets. No threshold, allowed failure or masked exit code
was added.

The additional alpha/coverage research scripts and existing Stage 1.2, shared-edge,
corner, source-quality and curve-optimization evidence scripts also completed
with exit 0. This verifies execution and their existing assertions, not acceptance
of every research configuration. The source-quality comparison covers 19 fixtures;
the curve evidence covers 35 comparisons and four actual Inkscape roundtrips.

One initial research invocation was interrupted by editing its shell script
while Bash was reading it; it produced no quality result. The unchanged rerun
completed with exit 0. The runner now restores both normal WASM and dist, preserves
failure exit status and removes only its own temporary worktrees. Changed Rust
modules pass rustfmt checks; a separate whole-crate formatting check reports
pre-existing formatting differences in unchanged `coverage.rs`.

GitHub CI for implementation commit: **PASS**, completed 2026-10-26 (9m30s),
including the feature build, actual browser exports and blocking recovery gate.
[Exact implementation workflow run](https://github.com/akidwush/vector-magic-bydika/actions/runs/40251873902).
The workflow includes the normal regressions and feature promotion gate. Main
remains at Stage 1.5; source_geometry is excluded from normal builds and Auto.

## Visual evidence, exports and reproduction

Artifacts are original generated evidence, not committed scores or private
binaries. Download `stage-01-evidence` from the workflow run; locally open:

- `benchmark-results/stage16b/exports/{cubic,wave}-{stage15,stage16,candidate}.svg`.
- `benchmark-results/stage16b/{cubic,wave}-{100,400,1000}.png`: Source Raster |
  Stage 1.5 | Stage 1.6 | Recovery, same viewport and identical ROI/scale. The
  1000% crop includes the original worst tip/junction. These screenshots were
  visually inspected; SVGs contain real editable paths, no raster/stroke cover-up.
- `benchmark-results/stage16b/comparison.json`, `quality-gate.json`, `probe/`.
- `benchmark-results/stage15/production.json`, `evidence.json`, `exports/` and
  `inkscape/`: full feature regression exports and independent rasterization.
- Local `benchmark-results/recovery/accepted/` preserves the final feature run
  and cross-resolution endpoint probes; `rejected-baseline/` preserves the old
  rejected experiment. These archives are ignored by git.

Use `NEXORA_CHROMIUM_PATH=/usr/bin/chromium` for installed local Chromium. For an
independent probe without replacing normal WASM, emit feature bindings to an
artifact directory and set `NEXORA_CANDIDATE_WASM` when running
`source-target-probe.mjs`; `TARGET_SIZE` selects the retained 128/512/1024 fixtures.

Changed files: new `engine/src/recovery.rs`; integration and signed-area reuse
in `engine/src/{lib,inverse,reduce}.rs`; adapter diagnostics in
`src/engine/{adapters,types}.ts` and `src/main.tsx`; new browser recovery test;
source-target benchmark/probe/research runner; workflow branch coverage, README
and this report. `source_fit.rs`, coverage math, segmentation, transparency and
upstream sources are reused unchanged.

**Promotion decision:** keep the follow-up research branch for review. Do not
merge or enable it globally in this change. Next work is reliable low-resolution
initialization, stronger source-supported tangent estimates, broader real-art
holdouts, peak-memory/device profiling, and safe coordinate serialization to
recover file-size efficiency. These must retain the present exported-geometry
and reconstruction gates.
