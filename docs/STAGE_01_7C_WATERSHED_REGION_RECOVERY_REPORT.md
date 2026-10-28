# Stage 1.7C — source-verified Watershed and Mosaic regions

**PARTIAL. Experimental only. No merge to main or production activation.**

A source-supported Mosaic boundary can be retained, with final paint and exact
shared-edge validation. Independent artwork-scale Watershed recovery and the
pale-garden repair remain unproven. Preserving a label or lowering global pixel
error does not count as recovering the complete illustration.

## 1. Revisions and evidence identity

- Exact base: `ad770ad49b6168a75c1751bfbed412aad824fc15`, branch
  `feat/stage-1-7b-thin-feature-preservation`.
- Work branch: `feat/stage-1-7c-watershed-region-recovery`.
- Initial classifier/rollback prototype: `3d10703`.
- Final source ownership, shared-IR guard and partition reuse implementation:
  `7169751e881379860836a749c9a902ed2db9252f`.
- Local one-split scheduler and visible-ownership unit correction:
  `7aef9de3b573aaa2e6aeeb06ed342ceca33e1f29` (after `06eb397`).
- Read-only Mosaic label-map capture: `170b384`; final research runner, visual
  and Inkscape proofs: `41b73fa`. No geometry semantics changed after `7aef9de`.
- Contract: [STAGE_01_7C_REGION_CONTRACT.md](STAGE_01_7C_REGION_CONTRACT.md).

Native/WASM inputs, source snapshots, dirty patch, Cargo locks, module manifests,
PNG and decoded RGBA hashes, actual download hashes and individual first/warm
observations are retained in fresh `benchmark-results/stage17c/` namespaces.
No historical Stage A/B/H–J measurement is overwritten. Generated raw scores and
compiled binaries are not committed. Curated evidence and this report are separate.

## 2. Actual architecture

The pinned VTracer, visioncortex and flo_curves integrations are unchanged; no
new dependency, tracer or rasterizer was introduced. Watershed builds the existing
4-neighbor pixel graph, counting-sorted MST and volume-persistence hierarchy.
At detail 96 the target is `round(2^(96/25.5)) = 14`, with ties in persistence
allowed to yield fewer distinctions. The legacy cut, midpoint snapping, small
basin absorption, leaf remapping and ancestor layering remain the normal route.

Palette fitting uses existing area-weighted median cut and OKLab snapping.
Consecutive equal-paint mask union and Mosaic's running-mean adjacency merge are
different operations. The graph, face assembly and shared segment fitter are
reused. The existing curve/reducer tolerances, source fitting and SVG writer
have not been retuned.

## 3. First destructive stages

The exact Stage B source bytes are replayed, with source-only intermediate masks
and actual export hashes. Region count, visible foreground components and visible
background holes are different metrics. Counts use the unchanged 4-connected
foreground/8-connected background convention, minimum 4 pixels, background color
separation >8 encoded-channel levels. They are not certified SVG compound holes.

| Case | Measured sequence / first loss |
| --- | --- |
| Pale garden512 | Source 12 foreground/12 negative spaces; cut 14 regions but only 3 visible foreground/0negative spaces; Mosaic subsequently13 visible owned regions →4paints, final 2 foreground/0negative spaces. Cut is already destructive before fitting; Mosaic causes additional paint separation loss. |
| Small symbols128 | ColorCluster route, not Watershed. Existing survival/residue decisions lose details; Stage C does not repair this route. |
| Clean garden512 | ColorCluster. Stage B mode 4 remains a separate reference for its two retained elongated gaps. |
| Orbital badge128/512 | Previously observed assessment family. Strong source dynamic range is outside this conservative low-contrast experiment; unchanged does not mean its remaining notch is repaired. |
| Botanical128 | Weak, coherent lower platform is absorbed during Mosaic adjacency merging. Other flowers/stems remain missing. |

Diagnostics retain pixel ownership, source means/standard deviations, paints,
areas, bounding boxes, neighbors and shared-boundary lengths. Overlap lineage
between snapshots distinguishes renumbering from real absorption or splitting.
`WATERSHED_CUT_MERGE`, `BOUNDARY_SNAP_CHANGE`, `SMALL_BASIN_ABSORPTION`,
`PALETTE_COLOR_COLLAPSE`, `MOSAIC_ADJACENCY_MERGE` identify observed pipeline stages,
not an assertion that every merge is defective. Semantic correspondence remains
uncertain where multiple source structures occupy one coarse basin. Full internal
binary-tree parent arrays are not exported as if they were semantic object IDs.

The final diagnostic binary captures the actual maps immediately before and after
Mosaic, within the unchanged 24 MiB snapshot ceiling. The following are source-only
intermediate **paint raster** measurements, not final SVG scores:

| Pale garden stage | Distinct owned regions | Visible foreground / negative space | RGBA MAE |
| --- | ---: | ---: | ---: |
| Original source | Not a segmentation | 12 / 12 | 0 |
| Watershed cut, detail 96, lambda 10497, minimum area 4 | 14 | 3 / 0 | 4.290109 |
| Boundary snapping | 14 | 3 / 0 | 4.257727 |
| Small-basin absorption | 14 | 3 / 0 | 4.257727 |
| Hierarchy emission / palette fitting | 14 | 3 / 0 | 4.257727 |
| Equal-paint flattening / immediately before Mosaic | 13 | 3 / 0 | 4.257727 |
| Immediately after Mosaic merge | 4 | 2 / 0 | 4.920016 |
| Final baseline SVG, libvips | 4 paths | 2 / 0 | 5.293861 |

Snapping changes pixel ownership but does not restore the lost components;
small-basin absorption is not the first loss here. Equal-paint flattening drops
one visible region ID without changing the visible component count. Recorded
overlap lineage confirms the subsequent 13-to-4 Mosaic absorption rather than
merely renumbered IDs. For example the pale banner basin, area 11,092 and bounding
box `[36,33,160,95]`, is absorbed into the dominant root; its paint is
`[251,248,240]` against `[252,252,252]`. This documents a decision, not proof that
every banner pixel should become a separate path.

Botanical 128 starts with 14 cut regions, 6 visible foreground components and
3 negative spaces. Palette/flattening leaves 7 owned regions. Mosaic reduces
them to one paint and loses all visible foreground. Its lower-platform basin
has area 515, bounding box `[12,112,103,5]`, and paint `[245,248,243]`. This is
the source-supported boundary that the final candidate actually retains.

## 4. Source-boundary evidence

The independently configured `watershed_region_research` feature implies none of
`thin_feature_research`, source geometry, large apex, hot-path or runtime cache.
Mode 0 preserves the old path; 1 enables Mosaic vetoes; 2 preserves eligible existing
MST distinctions; 3 combines. Mode 4 of Stage B is compiled separately from the
exact base as a ColorCluster reference, never presented as Watershed recovery.

Eligibility is intentionally narrow: opaque, at most 512² pixels, per-channel
range at most 64, at least 90% of pixels in 64 exact colors, with a 4096 unique-color
preflight cap. The converter receives only the raster, dimensions, preset and
explicit mode. It receives no filenames, reference SVG coordinates or another
resolution as evidence.

Both current roots need 16 pixels. Seven parallel transects at three source
radii require plateau variation ≤2.5 levels and separation ≥6 levels. Every sample
must belong to its appropriate CURRENT union-find root, including alternate cut
windows. Source colors are calibrated in encoded 8-bit RGB, not claimed as a
perceptual delta-E or a universal antialiasing inverse. Gradual transitions and
ambiguous alpha are rejected rather than relabeled automatically.

## 5. Mosaic intervention

The original paint-difference threshold and sorted pair ordering are unchanged.
Only a qualifying union may be vetoed. The evidence uses current roots, source
ownership, actual proposed paints, shared boundary support and the improvement
of retaining the two paints versus their weighted merged paint. No veto decision
is cached across a membership or paint change. Final dense IDs and running sums
remain upstream.

An audit found that source-blend merged twice: once for source correspondence,
once inside composition. Stateful budgets could yield different maps. The research
route now passes the already merged map to the SAME graph/fitter/face composer;
there is one authoritative partition. The disabled path retains the old behavior.

## 6. Watershed intervention

Only an MST edge that the existing persistence cut would absorb may be retained.
Current-root area, color variance, contrast and independently owned two-sided
support must pass. This preserves an existing tree split, without increasing
global detail or inventing a mask. Snapping, absorption and hierarchy emission
still execute normally. A native fixed-detail example demonstrates the mechanical
ability to retain a split, but that is not an artwork recovery result.

Raw pale-garden experiments retained four distinctions. They did not establish
safe independent recovery of missing flowers or holes. The final acceptance path
keeps the validated baseline when topology or paint is uncertain.

The final scheduler retains **at most one** certified below-cut edge, with all
evidence thresholds unchanged. On pale garden it retains a 120-pixel root
supported by 7 shifted observations, producing 15 cut regions but still only
3 visible foreground components. Other proposals have insufficient owned support
or mixed/non-flat root statistics. No claim is made that this recovers the twelve
source objects. The final candidate's 14 pre-Mosaic owned regions become 7;
later shared-edge validation rejects it and restores the original four-path SVG.

## 7. Final paint and rollback

The immutable legacy candidate is replayed at most once per changed eligible
image; there is no rerender per potential merge. All final closed paths, finite
coordinates, complexity caps and exact opposite internal line/cubic atoms are
checked AFTER ordinary refinement/reduction. A valid initial lattice graph alone
is insufficient.

Actual exported pale-garden controls are not all identical on incident faces:
the initial graph is shared, but later source-blend refinement operates on faces.
Atom mismatch is not proof that every unmatched atom creates a visible gap;
equivalent subdivision can also fail this conservative test. Stage C refuses
uncertifiable candidates rather than changing the older refinement globally.

For qualifying partitions the existing analytical Green integral and Bézier
flattener evaluate complete final-document paint. Fixed 8×8 changed tiles must all
avoid worse source RGBA, and global loss must improve. The flattener is reused in
fixed 64-cubic chunks for compound documents, preserving subdivision/accumulation
order; existing fitting budgets are not loosened. Independent Chromium/libvips
checks of the ACTUAL downloaded SVG additionally assess changed tiles and 2-pixel
contexts. IR validation does not certify arbitrary future serialization/renderers.

The native relative complexity contract is unchanged: at most baseline shapes
plus 24, and at most twice baseline commands plus 128. Botanical 512 proposes
6 shapes / 578 commands versus baseline 1 / 6. Its exact rejection is
`COMPLEXITY_GROWTH:shapes=1:6:commands=6:578`: 578 exceeds the existing 140-command
limit. It is rejected before paint scoring. That does not prove the unseen
candidate's paint is worse; it exposes a limitation of a relative budget against
an almost blank baseline. The guard was not enlarged to force a positive result.

## 8. Ablations and rejected methods

Unvalidated prototypes are preserved separately; their attractive numbers are
not the final accepted result.

| Pale garden512 | libvips RGBA MAE | Foreground IoU | Visible foreground | Paths / anchors | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Exact Stage B Auto | 5.293861 | 0.626865 | 2 | 4 /745 | Baseline, visibly incomplete |
| Raw Mosaic-only prototype | 5.040201 | 0.734328 | 3 | 6 /845 | REJECTED: worse local tile and uncertified final shared atoms |
| Raw cut-only prototype | 5.292757 | 0.626864 | 2 | 4 /744 | No material structural recovery |
| Raw combined prototype | 5.039861 | 0.734343 | 3 | 7 /850 | REJECTED |
| Final guarded research | Baseline retained | Baseline retained | 2 | 4 /745 | Rollback; not a repair |

The raw Mosaic worst local tile rose 17.031494→17.451416 despite the improved
full-image MAE. The initial mean-paint-as-source-evidence prototype made no changes;
actual source plateaus must be measured separately from quantized paints.

The supplementary planner family challenges equal-persistence MST cuts. It was
created after the first rule freeze and is **not a blind artwork holdout**.
Rounded and square headers isolate one geometry factor; both have independently
rasterized 128/512 versions. Initial 24-split trials were rejected. Final one-split
results are also rejected:

| Planner case | Final selected baseline MAE | Candidate outcome |
| --- | ---: | --- |
| Rounded 128 | 4.109239 | Final shared-edge mismatch; rollback |
| Rounded 512 | 3.767910 | Final shared-edge mismatch; rollback |
| Square 128 | 3.624023 | Native candidate MAE 3.555103, but 3 of 9 changed tiles worsen; rollback |
| Square 512 | 3.719604 | Final shared-edge mismatch; rollback |

The square 128 case demonstrates why improved global error is insufficient even
when exact shared atoms pass. Its two paths and twelve anchors remain baseline;
the missing day cells are not counted as recovered. A supplemental safety gate
with no changed records means unchanged-output safety, not successful Watershed
recovery. No local threshold was relaxed after these rejections.

## 9. Accepted local boundary and remaining loss

Initial independently rasterized/exported botanical128 evidence:

| Metric | Baseline | Source-veto candidate |
| --- | ---: | ---: |
| Premultiplied RGBA MAE | 1.642685 | 1.532669 |
| Foreground IoU | 0 | 0.243154 |
| Foreground components | 0 | 1 |
| Source foreground /negative spaces | 8 /3 | 8 /3 |
| Exported negative spaces | 0 | 0 |
| Paths | 1 | 2 |
| Editable anchors | 4 | 12 |
| Cubics | 0 | 0 |
| SVG bytes | 165 | 250 |

The extra eight serialized anchors represent one four-edge boundary in both
incident faces; four canonical edges are fitted once and used in exact reverse.
This is a recovered lower platform, NOT the recovery of the entire garden,
flowers or three missing holes. Low full-image MAE still hides extensive loss.
Final implementation revalidation and actual-download proof are recorded below.

Both independent renderers measure the same accepted 1.642685 → 1.532669 MAE.
All fourteen changed 8×8 tiles and their 2-pixel contexts improve or remain equal;
zero worsen. Four canonical internal line atoms occur twice in exact reverse;
unmatched atoms, invalid multiplicities and newly detected crossings are zero.
Changed pixels occupy `[12,112,103,5]`. Two veto events refer to reconsideration
of this same union, not two recovered semantic features. Cut protection is zero.

The seven-case ablation independently compares exact-base Auto, mode-0 observer,
Mosaic-only, Watershed-only, combined, and exact-base Stage B mode 4. Botanical
128 improves with Mosaic-only/combined; Watershed-only retains baseline. Pale
garden rolls back, and mode 4 is not credited with repairing a Watershed route.
All configuration, binary and original-source hashes are retained alongside the
downloaded files; comparisons are not between labels for an unspecified engine.

## 10. Generalization and split discipline

The corpus is the unchanged 31 legal Stage A images plus 8 Stage B images and 4 new
CC0 rasters, 43 images/23 independent design families. The new botanical family is
development; harbour was first assessed after the initial model freeze. Later
ownership/shared-edge safeguards follow code-path defects, not its reference
coordinates. Harbour revalidation is not counted as another independent holdout.
Both harbour resolutions were unchanged in the first frozen evaluation: this is
safety evidence, not positive recovery/generalization. Broader generalization is
unproven.

The new assets are original CC0 artwork. Their source SVGs and deterministic 4×
rasterization/Lanczos3 procedure are committed. Each resolution starts from its
own vector rasterization. Offline source reconstruction uses independent renderers;
true-original-vector geometric accuracy is not inferred from RGB/IoU alone.

## 11. Codec, alpha and thin-region controls

The first frozen 43-image run produced 86 image/configuration pairs and 182 actual
first/warm/reset downloads, with only botanical128 changed. Anime WebP/JPEG,
compressed fox, noisy garden, source alpha and all other existing artwork retained
their SVG bytes. Baseline codec fragmentation is NOT repaired or relabeled good.
Stage B mode 4 is an independently built reference; it is not silently activated
by this feature. Final revalidation and ablation artifacts remain separate.

| Control | Paths / anchors retained | libvips MAE retained | Outcome |
| --- | ---: | ---: | --- |
| Small symbols 128 | 23 / 388 | 6.592331 | Unchanged; lost wave and counters remain |
| Clean garden 512 | 112 / 4052 | 3.063187 | Unchanged; existing diagnostic crossing flags remain |
| Orbital badge 128 | 9 / 163 | 2.660146 | Unchanged; no notch-recovery claim |
| Orbital badge 512 | 10 / 432 | 0.959274 | Unchanged |
| Anime 512 WebP | 692 / 5810 | 3.959844 | Existing fragmentation retained, not improved |
| Anime 128 JPEG | 254 / 2392 | 8.401840 | Unchanged |
| Fox 128 JPEG | 220 / 2314 | 5.892227 | Unchanged |
| Garden 512 noise | 624 / 8791 | 3.563956 | Unchanged |
| Botanical 512 | 1 / 4 | 1.663313 | Complexity rollback; missing composition remains |
| Harbour 128 | 9 / 151 | 2.001832 | Holdout unchanged; Chromium MAE 1.921811 |
| Harbour 512 | 9 / 447 | 0.869700 | Holdout unchanged; Chromium MAE 0.845804 |

Forty-two of the forty-three artwork outputs remain byte-identical to exact-base
Auto. That includes compressed inputs and partial-alpha artwork. Existing
sampled crossing flags on unchanged clean garden (2) and harbour 512 (1) are
retained as diagnostics; they are not called newly repaired or certified valid.
The changed botanical output has no detected crossing. Detection is bounded and
is not a general proof of topology for every retained defective baseline.

## 12. Resource contract

- One retained cut distinction (initial rejected prototype: 24), 24 veto events
  maximum; 128 expensive evidence trials.
- 1 million charged source/edge observations, including 44 source observations per
  two-sided support probe; no all-region-pair quadratic scan.
- 512 diagnostic events, nine optional label/paint frames within the unchanged
  24 MiB snapshot byte cap. Stage B-only capture remains eight frames.
- 512² input eligibility cap, 4096 source colors, 8192 shared boundary elements
  per trial. At most 65,536 extra RGB reads for pair paint scoring.
- At most 128 final shapes, 16,384 commands, 65,536 flattened document vertices,
  2 million shape/sample contributions and 16 million estimated integral operations.
- At most one baseline replay for a changed candidate, with fail-closed rollback.

The work counter charges logical observations, not every physical RGB read.
Source preflight and hierarchy statistics are separate bounded linear passes.
Candidate labels/paint are not reused across changed membership. Region source
Arcs are reported absent after completion, including accepted/rolled-back traces.

Source Arcs, temporary maps and paint caches clear at normal trace completion;
Worker termination releases its module/heap during cancellation. WASM linear
high-water pages are allocation capacity, not live heap, browser RSS or Android RAM.
Normal Auto/default WASM omits this experimental code. Physical Android remains
**UNVERIFIED**.

The experimental wrapper currently clones the input before source eligibility;
on an ineligible input this bounded extra allocation can be up to 8 MB at the
existing two-million-pixel trace cap. Default builds do not pay this cost. It is
an optimization opportunity, not evidence of a retained source image or an
unbounded cache.

## 13. Tests, historical gates and failures

Every command has a preserved original exit status. The complete local delivery
and final one-split verification pass; the milestone is still PARTIAL.

| Check | Local observed result |
| --- | --- |
| Default Rust / source_geometry | 69 / 69 passed |
| large_apex / large_apex,inverse_hotpath | 72 / 76 passed |
| Final region feature / all explicit features | 76 / 83 passed |
| Final vendor native feature tests | 53 passed |
| TypeScript unit / lint / typecheck | 42 passed / exit 0 / exit 0 |
| Default production WASM / Vite | Exit 0; normal artifacts restored |
| Normal browser E2E | 27 passed |
| Three existing offline corner/source/curve readers | All exit 0 |
| Explicit experimental app browser E2E | 27 passed, repeated after one-split change |
| F versus H actual browser downloads | 45/45 byte-identical; original budget gate exit 0 |
| F/H plus final region feature | 45/45 byte-identical; original budget gate exit 0 |
| Entire source-target historical runner, once | Exit 0; original geometry, source, alpha and timing gates |
| Final release replay of all 43 artwork images | Selected download hashes identical to the actual main study |
| Actual Inkscape CLI roundtrips | 10/10 import/export; raster MAE 0; no embedded raster/open path |
| Changed-export local/context paint proof | Both renderers pass, 14 changed tiles, zero worse tiles |
| Worker cancellation/reuse/reset/real idle cleanup | PASS, 3 Workers created / 3 terminated |

The early verification used the wrong offline artifact-root level; three readers
exited 1. Their logs remain immutable. Corrected fresh verification passed the
same readers without changing their assertions. Initial native failures from
feature-test gating, a malformed local-loss test, a private test import and
confusing ancestor paint count with distinct visible region IDs remain retained.
The last correction changes the unit's quantity, not an engine threshold.

All old quality scripts and metric tolerances are unchanged. The nine protected
endpoint-inclusive maxima remain:

| Fixture | 128 | 512 | 1024 |
| --- | ---: | ---: | ---: |
| Triangle | 0.409670 | 0.985251 | 1.292558 |
| Wave | 0.502973 | 0.578088 | 0.660000 |
| Cubic | 0.823200 | 0.823200 | 0.766976 |

These refer to explicitly compiled F/H research recovery, not ordinary production
Auto. Exact exports preserve their corners, alpha, source loss and topology
measurements. Byte identity is not proof that every retained held-out shape is
correct. Prior Stage B +1018.5 ms and H–J severe latency failures remain historical
failures. The newly observed historical gate PASS neither fixes nor waives them.

## 14. Evidence and reproducibility

`scripts/watershed-region-research.sh` runs the full isolated study. It builds
exact base Auto, separate exact-base thin-mode 4, observer, Mosaic, cut and combined
modules; records command exits; exercises normal and experimental app Workers;
runs old source/45-case gates unchanged; restores normal WASM/dist even on failure.
`scripts/watershed-region-transitions.mjs` emits source-only per-region lineage.
No corrective paths, raster-embedded SVG or hand-edited conversion is used.

Curated unmodified downloads and aligned 100/400/1000% screenshots are in
[the evidence index](evidence/stage17c/README.md), with exact copy/source hashes.
Examples:

- Botanical: [baseline](evidence/stage17c/paper-botanical-128--A-auto.svg),
  [accepted candidate](evidence/stage17c/paper-botanical-128--combined.svg),
  [100%](evidence/stage17c/paper-botanical-128-100.png),
  [400%](evidence/stage17c/paper-botanical-128-400.png),
  [1000%](evidence/stage17c/paper-botanical-128-1000.png).
- Pale garden: [selected rollback SVG](evidence/stage17c/original-garden-512-low-contrast--combined.svg),
  [100%](evidence/stage17c/original-garden-512-low-contrast-100.png),
  [400%](evidence/stage17c/original-garden-512-low-contrast-400.png),
  [1000%](evidence/stage17c/original-garden-512-low-contrast-1000.png).
- Unrepaired symbols: [100%](evidence/stage17c/original-small-symbols-128-100.png).
- Holdout harbour: [100%](evidence/stage17c/paper-harbour-128-100.png).
- Rejected planner: [1000%](evidence/stage17c/pale-planner-square-128-1000.png).

All columns show actual selected downloads, including unchanged rollbacks; raw
rejected candidates are not substituted as successful export evidence. Inkscape
1.4 CLI roundtrips were actually run on botanical 128/512, pale garden, symbols,
and harbour, baseline and candidate. Manual GUI anchor editing, Illustrator and
physical Android remain UNVERIFIED.

## 15. Runtime, memory and lifecycle observations

The final independent seven-case app ablation uses the same original sources and
the final read-only-capture binary. These are individual first/warm observations,
not statistically supported latency medians or speedup claims:

| Fixture | Auto trace first / warm ms | Combined first / warm ms | WASM linear capacity, Auto → combined |
| --- | ---: | ---: | ---: |
| Botanical 128 | 72.8 / 27.7 | 116.3 / 32.9 | 2,686,976 → 3,276,800 B |
| Botanical 512 | 187.1 / 101.1 | 401.0 / 271.1 | 27,131,904 → 35,717,120 B |
| Pale garden 512 | 285.1 / 151.3 | 405.6 / 316.0 | 27,131,904 → 35,717,120 B |

First-call source wrapper observations, respectively:

| Fixture | Candidate ms | Baseline replay ms | Final validation ms | Final verdict |
| --- | ---: | ---: | ---: | --- |
| Botanical 128 | 58.7 | 16.5 | 14.5 | ACCEPTED |
| Botanical 512 | 225.7 | 119.1 | 1.4 | Complexity rollback |
| Pale garden 512 | 230.9 | 120.3 | 1.3 | Shared-edge rollback |

The wrapper intervals are sequential subintervals of the trace, not added costs
to add again to trace time. They exclude entry diagnostics/other outer work.
Ordinary stage fields after replay can describe the last baseline invocation;
their overlapping values must not be added as independent CPU measurements.
Click-to-result, decode, startup, first/warm and every reset observation remain
separate in raw JSONL. Snapshot diagnostics are not used as production timings.

Initial main-study observations remain preserved: botanical 128 combined
101.6/31.3 ms and pale garden 411.0/272.1 ms, alongside their own unchanged
comparators. Mixed single-session timing does not establish a speed improvement.
Noisy-garden capacity was 52,887,552 → 53,805,056 B. Capacity is not live heap,
browser RSS, or physical Android memory. Stage C adds real replay/evidence cost;
an unchanged rejected image may still cost substantially more work.

The actual Worker test retains first, warm and after-cancellation SVGs with the
same selected hash. It observed three Workers created and terminated and a real
29,935 ms idle-cleanup wait; no accelerated clock was used. Cancellation terminates
the Worker. The exact Rust stage reached before termination is not inferred.
Normal browser lifecycle/cancellation tests also pass. Physical Android remains
**UNVERIFIED**; no mobile-emulation claim is substituted.

## 16. GitHub CI status

[Run 40610070364](https://github.com/akidwush/vector-magic-bydika/actions/runs/40610070364),
commit `7169751`, is **FAIL**. Public job annotations identify the research
script's exit 1; artifact upload itself completed successfully. Detailed logs
require sign-in and the session's GitHub API request returned Forbidden, so a
complete list of its remote failing subcommands has not been observed. This is
not relabeled PASS because local results pass.

An audit found a concrete runner wiring defect: its diagnosis requested the new
botanical image but left `NEXORA_ART_FIXTURES` at the old 31-image default, where
that image is absent. Local standalone diagnoses had explicitly supplied the
combined corpus. The runner now supplies that same corpus and candidate hash
check, prints every original command status, and includes failure log tails in
the job summary. This is a harness correction, not a geometry/quality waiver;
other causes of the failed CI cannot be ruled out without its logs.

[Run 40621689370](https://github.com/akidwush/vector-magic-bydika/actions/runs/40621689370),
commit `41b73fa`, was **IN PROGRESS** at the last recorded check. No pending job
is called passing. It runs the full original checks plus supplemental planner,
visual and Inkscape proofs; raw artifact name is
`watershed-region-raw-<full commit SHA>`, uploaded with `if: always()` even on
failure. Historical failure data stays in its original artifact/run.

## 17. Files and reproducible artifact namespaces

Changed engine/vendor files:

- `engine/Cargo.toml`, `engine/src/lib.rs`, new `engine/src/region_validation.rs`.
- `vendor/vtracer/Cargo.toml`, `src/lib.rs`, `src/pipeline.rs`,
  `src/frontend/watershed.rs`, `src/mosaic.rs`, `src/mosaic/compose.rs`,
  `src/thin.rs`, new `src/region_research.rs` under that vendor root.

New research tooling uses `scripts/watershed-region-*` for isolated exact-base
builds, legal corpus generation, app exports, source-only region diagnostics,
overlap lineage, paint/complexity metrics, exact shared atoms, final-paint safety,
visuals, Inkscape and Worker/enabled regression proofs. A branch-only workflow is
in `.github/workflows/watershed-region-research.yml`. New fixtures live in
`tests/fixtures/watershed-region` and `watershed-region-ties`, each with CC0 source
metadata. No application UI/adapters, existing geometry math, historical gate,
source-image acceptance tolerance, upstream dependency or lock version changed.

Important ignored raw namespaces under `benchmark-results/stage17c/`:

| Namespace | Evidence |
| --- | --- |
| `prototype-evaluation-*`, `modules-prototype-*` | Unaccepted region trials, including attractive but unsafe pale-garden gains |
| `verification-v1` | Preserved first offline-root failure |
| `delivery-v1` | Full final local normal/experimental/historical checks, 43 actual artwork pairs, 42 ablation pairs, visuals and Inkscape |
| `tie-development-v1` | Original rejected many-split planner experiment |
| `local-cut-proof-v1` | Final one-split trials, 43 export replay, Worker lifecycle, enabled 45 comparisons and budgets |
| `final-diagnostic-v1` | Final native tests, all-43 release replay, actual before/after Mosaic maps and source-only lineage |
| `final-ablation-v1` | Final binary, 42 actual app image/config pairs, independent paint/safety proof; all command exits 0 |

The last two replay/ablation runs match the main study's selected SVG hashes.
They do not overwrite earlier observations or count replayed warm traces as
independent performance sessions. Source PNG and RGBA identities, glue/WASM SHA,
config options, per-trace SVG SHA and source snapshots are retained. Raw scores
and compiled binaries are not committed; curated actual SVGs/screenshots and
this authored measurement report are committed separately.

## 18. Limitations and promotion decision

Keep the feature experimental and off globally. Mosaic-only recovery is narrow;
independent successful artwork-scale Watershed recovery, pale-garden repair,
missing symbols, thin open gaps and broad held-out generalization remain unfinished.
The exact-atom guard can reject equivalent differently subdivided geometry; this
is deliberate conservatism, not proof of every visual gap. Stable low-contrast
codec blocks can still resemble intentional detail; the current negative corpus
is not a universal noise guarantee. Final paint acceptance is limited to measured
renderers/cases and resource budgets.

Recommended Stage 1.7D: retain canonical shared geometry through the existing
source-blend post-composition refinement, then evaluate localized hierarchy
splits and palette/paint acceptance. This dependency outranks another global
Bézier smoother: unsafe per-face output and missing region distinctions must
first be made auditable and locally valid.

Completion assessment: Mosaic boundary recovery and independent final-paint
improvement are demonstrated narrowly. No accepted independent artwork-scale
Watershed recovery, no new negative-space survival, no pale-garden repair and no
positive broad holdout recovery are demonstrated. The native mechanical split
test, unchanged-output safety gates and accepted platform are not substitutes.
Remote CI has a retained failure and a pending revised run. **PARTIAL; do not
merge, enable globally, or claim Vector Magic equivalence.**
