# Real-artwork evaluation taxonomy

An anomaly is not a confirmed defect or root cause. Keep four evidence levels:
**MEASURED** (numeric fact), **SUSPECTED** (automated flag), **VISUALLY CONFIRMED**
(a specified source/export crop), and **ROOT CAUSE SUPPORTED** (additional code or
controlled evidence). Record renderer, configuration, crop and uncertainty.
Do not infer shared-edge drift from a raster hairline alone.

| Family      | Standard failure                                           | Evidence needed before confirmation                                                                        |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Geometry    | Excessive anchors / polygonal smooth curve                 | Path/control overlay and source curvature; density alone is a candidate                                    |
| Geometry    | Rounded true corner / false G0 / displaced tip             | Reference or supported source feature, final exported tangent/vertex check                                 |
| Geometry    | Incorrect circle / ellipse                                 | Supported shape hypothesis, geometric residual; do not force organic eyes into ellipses                    |
| Topology    | Broken hole / containment / missing narrow space           | Known negative-space region, winding or independent rendering; white paint alone is not a transparent hole |
| Topology    | Self-intersection                                          | Proper within-subpath crossing and intended winding; cross-face occlusion is not self-intersection         |
| Topology    | Incorrect overlaps                                         | Source layering/ownership and actual painted region; stacked overlap can be intentional                    |
| Topology    | Shared-edge divergence                                     | Compare coordinates/reversed curves of known adjacent faces; distinguish browser compositing seams         |
| Color / AA  | False intermediate rings / color bleeding                  | Local palette/ownership and transition support; an intermediate color can be intentional                   |
| Color / AA  | Lost transparency                                          | Premultiplied RGBA, alpha error, intrinsic opacity and coverage distinction                                |
| Color / AA  | Incorrect AA / tiny-region segmentation                    | Source neighborhood, palette classes, region/path evidence; never histogram alone                          |
| Color / AA  | Palette fragmentation                                      | Distinct solid fills, tiny faces, reconstruction and intentional palette                                   |
| Detail      | Missing eye/pupil / merged hair / lost decoration          | Named ROI source/export crop and feature-specific observation, not global MAE                              |
| Detail      | Lost glyph counters / wrong line thickness                 | Named glyph/line ROI and negative space/support; grid threshold sensitivity disclosed                      |
| Complexity  | Tiny paths / excessive layers / difficult editing          | Editable node distribution, purpose of mask/paint geometry, actual import result                           |
| Complexity  | Large file without fidelity gain                           | Matched source/configuration, fidelity plus bytes; no arbitrary compression target                         |
| Performance | Slow conversion / cancellation / memory / unsupported size | Actual Worker/UI state, measured lifetime, caps; not desktop Android extrapolation                         |

The automatic subset and fixed thresholds are in `scripts/real-artwork-metrics.mjs`:
local tile MAE >12, interior RGB MAE >4, alpha MAE >2 for partial-alpha sources,
foreground negative-space changes, >2 unsupported narrow-source pixels,

> 150 anchors with >12 anchors/100px contour, >16 tiny boxes comprising >15% paths,
> and proper crossing candidates. These are new benchmark triage heuristics, not
> acceptance limits or modifications to historical gates. All carry SUSPECTED status.

Visible-silhouette geometry excludes hidden internal painter boundaries. Raster
negative space uses 4-connected foreground / 8-connected background and >=4px
components. The white-background mask uses maximum RGB distance >8 from the
specified background and alpha >=128. IoU is unavailable for the natural raster
city screenshot. No true-vector metrics are assigned to raster-only rows.

Ranks in the Stage 1.7A report use affected **independent design groups**, not
multiple sizes or sibling portraits from one template as independent votes.
The original family split and its metadata-only correction remain auditable.
Severity and proposed engineering cause require
visual review. Holdout is descriptive evaluation only; do not adjust thresholds
or engine eligibility based on its outcomes.
