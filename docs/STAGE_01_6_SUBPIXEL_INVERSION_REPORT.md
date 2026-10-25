# Stage 1.6B — source-calibrated geometry recovery

**Decision: FAIL / REJECTED for activation. No merge or global enablement.**

Base: `feat/stage-1-6-analytical-coverage`, verified
`db06a032f7180f349b275ef3801854c048bb674d`.
Follow-up: `feat/stage-1-6b-source-geometry`.
Stage 1.5 comparator: `6084faffbd18313c80b7d4bc8bec349dd88b63c8`.

The solver now uses subpixel targets to change actual exported geometry. It
improves some boundaries, but fails the required joint p95/maximum/corner and
source-reconstruction gates. The failed candidate is compiled only with
`--features source_geometry`; normal builds, including the existing experimental
source checkbox, exclude it. No threshold was lowered to call this successful.

## Reused foundations and source evidence

VTracer remains the tracer; segmentation, region ownership, the shared-edge
cache, continuous polygon coverage, calibrated unmixing and signed-offset
inversion are reused. No new tracer, rasterizer, model dependency or service.
AGENTS/handoff and the preceding source pipeline were audited before editing.

`Sample.trusted` records only colour/gamma evidence: the owned opaque component
must support a two-colour model, a decisive calibrated gamma selection and a
small mixing residual. It is not proof of single-boundary geometry. Partial
alpha remains rejected. Planar samples and open/junction chains are not eligible
for this prototype; existing shared-edge reuse stays intact.

For each eligible transition pixel, a 4px spatial grid locates a nearby initial
cubic and its parameter. Its tangent supplies an outward normal; local tangent
variation must pass the direction test. The existing analytical inversion gives
`target = pixel_center + offset(coverage, normal)*normal`. Point-to-curve residuals
are projected onto the normal; they never become one SVG anchor per pixel.

## Bounded solver and objective

The candidate parameterization moves each existing knot and its adjacent handles
together. For cubic Bernstein weights, a start-knot displacement has coefficient
`B0+B1`, and an end-knot displacement `B2+B3`. The source-target equations form a
regularized normal system for 2N coordinates. Endpoint closure and existing join
tangent directions survive these coupled translations before quantization.

The least-squares surrogate includes a Tikhonov displacement prior and neighboring
displacement regularization, excluding detected hard turns from smoothing.
Complexity is constant within this pass: no new knot/curve is inserted. Final
node reduction remains separate and may keep more nodes on a changed shape.

Actual proposals are accepted only if original-raster coverage loss does not
increase and `L_coverage + 0.1*L_target_geometry` improves. Source geometry remains
subject to existing winding, mask drift, collision, nesting and ownership checks.
The preceding initialization and whole-pass rollback are retained. This source
objective is demonstrably insufficient for promotion; the independent export
quality gate is mandatory.

Limits: <=128 cubics, <=8192 source samples, <=16384 tessellation pieces,
<=65536 grid entries, <=2 million nearby distance checks, a <=256-coordinate dense
system, three refinement iterations and three backtracking scales. Per-step
knot movement is <=0.75px; cumulative baseline displacement is separately bounded.
Singular systems, unsupported evidence and invalid geometry roll back. The loop
stops for <0.005px proposals or no accepted improvement. Open chains return the
input unchanged. This is bounded research, not a convergence guarantee.

## Actual failures targeted and root causes

The retained baselines' worst locations are the acute cubic tip and wave's first
vertical/curved junction. A smaller mean source loss can move these corners the
wrong way while improving the long contour. Tiny splice segments and subsequent
node reduction mean intermediate detected corners do not reliably identify the
critical final serialized vertex. This failed protection is a blocker, not an
acceptable corner refinement.

An acute tip can also place both sides of a region inside one pixel: two-colour
membership does not make the single-half-plane inversion valid there. Color and
gamma confidence cannot substitute for a local boundary-multiplicity test.
Experiments excluding opposing nearby segments still did not establish robust
tip recovery. The existing mask drift guard was not globally loosened.

The next viable solver needs output-consistent corner constraints, explicit
multi-edge/acute-tip likelihoods, and high-error span scheduling rather than
unconstrained closed-ring redistribution. These remain unresolved; this patch
must not be described as completing Stage 1.6B.

## Three-build browser proof

The benchmark builds the actual Stage 1.5 and Stage 1.6 commits in temporary
worktrees and the feature candidate separately. Chromium loads each WASM module,
traces original decoded pixels, downloads real SVG blobs and measures the exported
paths. All three use Illustration and `inverse-reduce-reconstruct`; this matches
the source-enabled Stage 1.5 values specified in the task. WASM initialization
is recorded separately from tracing.

Ground truth is the retained legal vector reference. The existing symmetric
sampled distance rule and identical reference sampling are retained. Chromium
and libvips independently rasterize actual exports against the original PNG.
The maximum is sampled, not an analytic Hausdorff certificate.

| Fixture / build | Mean px | p95 px | Sampled max px | Corner precision / recall | Anchors | SVG bytes | Trace ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| cubic / stage15 | 0.091762 | 0.371053 | 1.561513 | 1.000 / 1.000 | 73 | 2179 | 742.2 |
| cubic / stage16 | 0.091762 | 0.371053 | 1.561513 | 1.000 / 1.000 | 73 | 2179 | 1022.2 |
| cubic / candidate | 0.053294 | 0.186851 | 1.966913 | 0.667 / 0.667 | 76 | 2342 | 993.6 |
| wave / stage15 | 0.079448 | 0.298474 | 1.000000 | 1.000 / 1.000 | 57 | 1839 | 547.2 |
| wave / stage16 | 0.079448 | 0.298474 | 1.000000 | 1.000 / 1.000 | 57 | 1839 | 534.3 |
| wave / candidate | 0.083441 | 0.262392 | 0.724224 | 1.000 / 1.000 | 61 | 2020 | 736.9 |

Cubic's true reference corner is (928,320). Its baseline exported corner is
(927.62,321.58), about 1.625px away; the candidate moves it farther away.
The legacy contour sampler's maximum is slightly lower because its reference
polyline samples near the vertex. `source-target-probe.mjs` provides a second
independent path-flattening sampler including exact reference endpoints; it also
rejects the candidate's cubic maximum. We do not replace the old metric with a
more favorable sampler.

| Fixture / build | Premultiplied RGBA MAE libvips | MAE Chromium | Source loss | Source evaluations | Target observations / accepted steps / ms |
|---|---:|---:|---:|---:|---:|
| cubic / stage15 | 0.540209 | 0.543315 | 0.00504485 | 189 | n/a |
| cubic / stage16 | 0.540209 | 0.543315 | 0.00504527 | 189 | n/a |
| cubic / candidate | 0.530088 | 0.532371 | 0.00177800 | 195 | 2895 / 3 / 137.1 |
| wave / stage15 | 0.539178 | 0.541712 | 0.00439934 | 137 | n/a |
| wave / stage16 | 0.539178 | 0.541712 | 0.00440529 | 137 | n/a |
| wave / candidate | 0.541106 | 0.542093 | 0.00400062 | 144 | 2672 / 1 / 164.0 |

Target observations count reused points per iteration, not unique source pixels.
Source loss diagnostics precede final simplification; independent exported metrics
are authoritative. Pixel loss drops strongly on cubic while its maximum/corner
accuracy worsens. Wave's maximum improves, while mean and source reconstruction
regress. These are explicit failures. Runtime is a desktop sample, not an Android
claim or stable speed guarantee.

## Experiments and performance

1. Coupled knot translations: source targets reduce cubic mean/p95 and wave's
   maximum, but displace the cubic tip and underconstrain already-correct straight
   sides. Rejected by actual exports despite lower source loss.
2. Opposing-edge exclusion and a weaker trust prior: still fails the cubic tip.
3. Additional scalar handle-length variables on fixed rays: more expensive and
   still fails both required maximum improvements. Rejected.
4. Fully covered/uncovered pixel inequalities plus additional corner constraints:
   improved some means, but failed meaningful maximum recovery. Rejected.
5. Intermediate protected-corner variants: did not protect the final cubic tip
   through tiny splices/simplification. Rejected; no false claim of preserved
   protected features.
6. Spatially indexed coupled-translation candidate retained **for research only**:
   same geometry behavior, less unnecessary searching. The report tables describe
   this final, rejected candidate.

The old inverse pass performs roughly 189 coverage evaluations on cubic and 137
on wave, repeatedly flattening the contour for span-local scoring. The indexed
target proposal adds only a few full coverage evaluations, tessellates once per
iteration and queries nearby segments. The dense solve and target construction
still add CPU. This is better bounded than running a global raster loss for every
individual handle coordinate, but does not justify activation without quality.
Target timing is included inside the existing source-phase timing, not additive.
Peak RSS and physical Android measurements remain unavailable. Matrix allocation
is bounded to roughly 0.5MiB plus target/grid storage; that is not a measured total
memory peak. Worker cancellation/reset and warm WASM reuse remain unchanged.

## Structural and regression evidence

The three-build comparison records final closure, proper sampled crossings,
acute-turn counts, smooth-join angles and corner positions. Coincident parsed endpoints are normalized within 1e-6px, with bow-tie and
shared-join sanity checks. A sampled crossing check is not a formal proof against every tiny loop. No claim of universal
geometric validity is made from SVG validity alone.

40 native tests include an actual synthetic source-circle perturbation whose
geometry and coverage improve without adding anchors, plus closed-join, invalid
junction and untrusted-evidence rollback checks. 37 TypeScript tests, lint,
typecheck, Rust/WASM/Vite builds and all 21 default browser tests pass locally.
The feature browser suite also completes all 35 export comparisons, cancellation,
worker reuse, unsupported alpha/photo routes and shared-edge checks. Its primary
geometry/corner gate nevertheless FAILS. No existing threshold is reduced.

## Quality gate and artifacts

`scripts/source-geometry-quality-gate.mjs` requires at least 5% mean, p95 and
maximum improvement on both primary fixtures, no corner/reconstruction regression
and bounded extra runtime. The failed gate exits nonzero. CI runs the default
regressions first, then this research gate on the follow-up branch; an overall
red workflow is the correct result for this rejected candidate. No continue-on-
error or masked exit code is used to label it successful.

Generated measurements, original downloads and visual comparisons are ignored
artifacts under `benchmark-results/stage16b/`:

- `exports/{cubic,wave}-{stage15,stage16,candidate}.svg`.
- `comparison.json`, `quality-gate.json`, `probe.json`.
- `cubic-100.png`, `cubic-400.png`, `cubic-1000.png` and wave equivalents: Source |
  Stage 1.5 | Stage 1.6 | Candidate at exactly the same viewport/ROI/scale.
- `rejected-first/` and archived intermediate logs retain failed experiments.

Reproduce with the existing toolchain:

```sh
./scripts/build-wasm.sh
cargo test --manifest-path engine/Cargo.toml --locked
cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
npm test && npm run lint && npm run typecheck && npm run build
npm run test:e2e
bash scripts/source-target-research.sh  # expected nonzero until the gate passes
```

For local installed Chromium, prefix browser commands with
`NEXORA_CHROMIUM_PATH=/usr/bin/chromium`. The research script restores production
WASM even on rejection. It builds reference commits from their exact hashes,
never changes the working branch and removes only its temporary worktrees.
No generated metrics, compiled WASM or uploaded images are committed.

Modified: inverse/source_fit Rust modules, feature declaration, source-target
probe/browser benchmark/research runner, independent promotion gate and workflow.
The branch is reviewable; main remains at Stage 1.5. Per-commit CI and failed
quality evidence are available from
[the branch workflow](https://github.com/akidwush/vector-magic-bydika/actions?query=branch%3Afeat%2Fstage-1-6b-source-geometry).
