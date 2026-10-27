# Stage 1.7B experimental contract

Base: `ca3871e14ca633aad09503e78681631348d71b75`.
This contract is recorded before candidate outcomes on the Stage 1.7A holdout or
new stencil/ribbon validation designs are inspected. Development uses signage,
portraits and the new circuit-ribbon family. Existing small-symbols/garden split
assignments remain validation-only despite their primary-target names in the task.
Baseline diagnosis identifies failure classes; no reference geometry reaches the
protection predicate.

## Scope and ablations

- Cargo `thin_feature_research` forwards only the corresponding VTracer feature.
  It does not imply source_geometry, large_apex, inverse_hotpath or runtime_cache.
- Unconfigured research builds use mode 0 (unchanged behavior). An isolated binding
  initializer selects modes in the actual browser app; production is untouched.
- Mode 0: ordinary clustering, or its exact predicate with diagnostic capture.
- Mode 1: color precision 8 only; output palette budget is unchanged. This is a
  counterfactual ablation, not a production recommendation.
- Mode 2: omit only the thread-like perimeter test, retaining strict area and layer
  difference tests. This is the unsafe overpreservation control, never minimum
  area zero and never the promoted candidate.
- Mode 3: source-guided survival overrides only. Ordinary successful decisions,
  nearest-color merge targets, hollowing, hierarchy, fitting and serialization
  remain upstream. No full-image second trace, mask insertion or post-SVG redraw.

## Source evidence

Protection is unavailable on legacy routes or non-opaque sources. A successful
baseline patch is never modified. For rejected patches, area must be 4–4096px,
inside the existing max-area bound and outside a 3px clipped-support margin.
The existing nearest-neighbor layer difference must still pass.

For a coherent ridge, at least 70% of source colors must be within 24 channel
levels of the cluster mean. At least 55% / six patch samples must exhibit opposed
neighbors with color disagreement ≤16 and center contrast ≥24, at two of three
radii (1, 2, 3px) in one of four normals. The patch must span at least 8px.
This tests spatial and color support, not a three-pixel turn or fixture name.
One-sided antialias bands fail the opposed-neighbor test.

For negative space, four opaque corner colors must agree within eight channel
levels. The candidate must be closer to that observed background than one quarter
of its parent's background separation; parent/background contrast must be ≥48.
Only a local bounding box plus 4px is examined, with patch sides ≤48px. Using
8-connected background throughout:

1. A background-tolerance-16 component must be locally closed and own all bright
   candidate seeds; an escape to the window/image edge rejects it.
2. It must contain exactly one meaningful tolerance-8 core of 4–256px, with at
   least four candidate-owned pixels. Distinct meaningful cores are not merged.
   Smaller threshold fragments can be AA fringe, not independent topology.
3. Reusing the observed source background paint must improve source-pixel L1
   error by at least 25% relative to absorption into the current parent.

Only a newly preserved negative region receives that existing source background
paint, before palette fitting. Existing successful gray regions are not repainted.
This avoids interpreting coverage-biased mean gray as a new solid color. There
is no universal white paint, stroke, raster embedding or background flattening.

## Bounds and cleanup

At most 64 additional survival decisions, one million charged patch pixels and
one million charged local-probe cells per trace. Actual flood visits/probe counts
are reported separately from conservative charged budgets. Flood windows contain
at most 56×56 cells; ordinary fitting/resource limits remain unchanged.

The original raster is shared by Arc, not copied for normal protection. The source
scope guard releases it and invalidates paint lookup entries on every exit.
Diagnostic capture is separately opt-in: at most 24MiB image/vector captures,
eight raster frames, 4MiB per vector dump and 16,384 bounded event records. Capture
cost and omitted records must not be presented as normal runtime or complete logs.
The ordinary app Worker cancellation/reset/reuse semantics are preserved.

## Frozen evaluation and rejection

Use the original source bytes and independent Chromium/libvips rasterization.
Report negative-space connectivity (4-foreground / 8-background), source RGB/alpha,
worst local crops, proper-crossing suspects, editable nodes/paths/colors and bytes.
A negative-space raster component is not automatically an SVG compound hole.

- Feature-disabled F/H must retain all 45 exact exports and historical gates.
- Feature-enabled protected Triangle/Wave/Cubic geometry may not worsen its
  endpoint-inclusive mean/p95/max, corner retention or topology versus baseline.
- Four existing codec/noise controls must remain byte-identical on their unchanged
  legacy routes; this is not a claim that arbitrary codec noise is solved.
- Repaired source regions must improve or retain local reconstruction, without
  meaningful source/alpha regression or unsupported extra shapes.
- Complexity growth is assessed against restored structure and bounded decisions,
  not an arbitrary low node target. A material clean/control regression rejects
  broad promotion; favorable global MAE cannot waive a damaged local feature.
- Keep all old timing/quality thresholds unchanged and preserve every failure.
  No favorable rerun replaces a failed invocation. Android remains UNVERIFIED.

If held-out results disappoint, report the limitation or reject the candidate;
do not tune its thresholds against held-out SVG coordinates. A later independent
algorithm change requires a new untouched validation family.
