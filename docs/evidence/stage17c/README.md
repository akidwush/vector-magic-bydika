# Stage 1.7C actual export evidence

Unmodified, hash-verified browser downloads and aligned browser screenshots.
Columns are original raster / exact Stage B Auto download / selected Stage C
combined download. All PNGs are real screenshots at the indicated scale, with
identical source coordinates. No pixel enhancement, redraw or reference leakage.

Only `paper-botanical-128` changes: a lower platform is retained. The other SVG
pairs are deliberately identical rollback/negative-control evidence; they are
not claimed as recovered artwork. In particular pale garden and the planner
remain defective. Source vector references are never passed to the optimizer.

Original legal CC0 sources and reproducible rasterization:

- [Stage A original artwork](../../../tests/fixtures/real-artwork/manifest.json)
- [Stage B original artwork](../../../tests/fixtures/thin-feature/manifest.json)
- [Stage C botanical and harbour](../../../tests/fixtures/watershed-region/README.md)
- [Supplementary planner stress family](../../../tests/fixtures/watershed-region-ties/README.md)

Planner fixtures were designed after the first rule freeze to probe MST tie
selection, not used as blind generalization evidence. Native rejected candidates
and raw score/timing files stay in separate immutable CI artifacts; the figures
here always depict the actual selected downloads, including rollbacks.

The complete raw source/binary/config manifests, actual downloads, independent
Chromium/libvips metrics, Inkscape roundtrips, region lineage and failed trials
are uploaded by the research workflow. See the
[report](../../STAGE_01_7C_WATERSHED_REGION_RECOVERY_REPORT.md).

## Exact copied artifacts

The last column is the immutable local artifact-relative origin, reproduced by
`scripts/watershed-region-research.sh`. These are identity/provenance hashes,
not quality scores.

| File | SHA256 | Origin |
| --- | --- | --- |
| [paper-botanical-128--A-auto.svg](paper-botanical-128--A-auto.svg) | `088d6362ce470d46a74be706f159dc484469c10115fc0a67d957ffe878854ccc` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-botanical-128--A-auto--first.svg` |
| [paper-botanical-128--combined.svg](paper-botanical-128--combined.svg) | `422a9c2a0970c1fd28a2c64052cbbab901995ee783bc84026bf1d0c867f95fc0` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-botanical-128--combined--first.svg` |
| [paper-botanical-512--A-auto.svg](paper-botanical-512--A-auto.svg) | `c20287e7373e3dfc07e200991673ceeb9b89ee84e82285ee29a14099c4848197` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-botanical-512--A-auto--first.svg` |
| [paper-botanical-512--combined.svg](paper-botanical-512--combined.svg) | `c20287e7373e3dfc07e200991673ceeb9b89ee84e82285ee29a14099c4848197` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-botanical-512--combined--first.svg` |
| [original-garden-512-low-contrast--A-auto.svg](original-garden-512-low-contrast--A-auto.svg) | `d61647569bec823ce1b8d1c1a1a19934d1f96fefed1e480b65a1a1c188a2bafc` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/original-garden-512-low-contrast--A-auto--first.svg` |
| [original-garden-512-low-contrast--combined.svg](original-garden-512-low-contrast--combined.svg) | `d61647569bec823ce1b8d1c1a1a19934d1f96fefed1e480b65a1a1c188a2bafc` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/original-garden-512-low-contrast--combined--first.svg` |
| [original-small-symbols-128--A-auto.svg](original-small-symbols-128--A-auto.svg) | `609bcd03efb015cc38be9ae40e69e367b3cff622e1e3042125dec244620c4212` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/original-small-symbols-128--A-auto--first.svg` |
| [original-small-symbols-128--combined.svg](original-small-symbols-128--combined.svg) | `609bcd03efb015cc38be9ae40e69e367b3cff622e1e3042125dec244620c4212` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/original-small-symbols-128--combined--first.svg` |
| [paper-harbour-128--A-auto.svg](paper-harbour-128--A-auto.svg) | `1b0025e5a6099245e828159e1d482c50eeb8a9e3a28bf403a3b17d6d197f4c51` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-harbour-128--A-auto--first.svg` |
| [paper-harbour-128--combined.svg](paper-harbour-128--combined.svg) | `1b0025e5a6099245e828159e1d482c50eeb8a9e3a28bf403a3b17d6d197f4c51` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/paper-harbour-128--combined--first.svg` |
| [orbital-badge-128--A-auto.svg](orbital-badge-128--A-auto.svg) | `33ff294629ce496280c9f3b5a3fdf54e0685bb224b1b9d6d799b89a214b41a35` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/orbital-badge-128--A-auto--first.svg` |
| [orbital-badge-128--combined.svg](orbital-badge-128--combined.svg) | `33ff294629ce496280c9f3b5a3fdf54e0685bb224b1b9d6d799b89a214b41a35` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/orbital-badge-128--combined--first.svg` |
| [orbital-badge-512--A-auto.svg](orbital-badge-512--A-auto.svg) | `c6f8a93e1cabc1477e5f3ee63cc63011d5568b5aeb529fb6eb9af4b35b68ef5e` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/orbital-badge-512--A-auto--first.svg` |
| [orbital-badge-512--combined.svg](orbital-badge-512--combined.svg) | `c6f8a93e1cabc1477e5f3ee63cc63011d5568b5aeb529fb6eb9af4b35b68ef5e` | `benchmark-results/stage17c/delivery-v1/evaluation/exports/orbital-badge-512--combined--first.svg` |
| [paper-botanical-128-100.png](paper-botanical-128-100.png) | `6578809d5c142e8acd1e97a21bd04de33320f0d20c8f5b32416adb35483ab194` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-botanical-128-100.png` |
| [paper-botanical-128-400.png](paper-botanical-128-400.png) | `c63d2e8d3b22876735361ae707908ad7515b8ef29bea11017a01dac93c66d469` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-botanical-128-400.png` |
| [paper-botanical-128-1000.png](paper-botanical-128-1000.png) | `58e0158dd855e6fdb59ae80e27e0bed1e242311197847c023268795960141873` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-botanical-128-1000.png` |
| [original-garden-512-low-contrast-100.png](original-garden-512-low-contrast-100.png) | `c55e075686aa93030f1358432e8c561eefec6d0b8ce74318e22cccc3134399e9` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-garden-512-low-contrast-100.png` |
| [original-garden-512-low-contrast-400.png](original-garden-512-low-contrast-400.png) | `b8225d2c4ee9ad5e4af426bd57f623b1e95500f649d007f35c2d9d6f780ec814` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-garden-512-low-contrast-400.png` |
| [original-garden-512-low-contrast-1000.png](original-garden-512-low-contrast-1000.png) | `a3869daaac4354daffe62f9b5b466476c77a927ed9937d39bb6544af0153e095` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-garden-512-low-contrast-1000.png` |
| [original-small-symbols-128-100.png](original-small-symbols-128-100.png) | `9b3ffe8bd1a78e19526b2e98a20b44954308cbb52e7a12183d18fd2f63586e6a` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-small-symbols-128-100.png` |
| [original-small-symbols-128-400.png](original-small-symbols-128-400.png) | `d929538c06c75d227439734a0892753a2be3cf1a2a1dc10a888ac1c178755e24` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-small-symbols-128-400.png` |
| [original-small-symbols-128-1000.png](original-small-symbols-128-1000.png) | `670b1db4e054bf121f2982f6d647be3be535c335ceab6eabc72ed32ce32ba203` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/original-small-symbols-128-1000.png` |
| [paper-harbour-128-100.png](paper-harbour-128-100.png) | `6dd51f8b3d60870f0dade2c83788fee14ca6a73306096e7198be3f09cf797fdf` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-harbour-128-100.png` |
| [paper-harbour-128-400.png](paper-harbour-128-400.png) | `3d5e5c6611efe4627f1b49b3a1d29039db6a6d8740f23905f5ef6c469f335043` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-harbour-128-400.png` |
| [paper-harbour-128-1000.png](paper-harbour-128-1000.png) | `467139bf6213184185a6642dac2800257e73f404f07a8a88f24cd4c580e0ffb7` | `benchmark-results/stage17c/delivery-v1/evaluation/aligned-visuals/paper-harbour-128-1000.png` |
| [pale-planner-square-128--A-auto.svg](pale-planner-square-128--A-auto.svg) | `7dea0103bd818d566c44a3ebabcabe8df96ad165e958ed07d95609d9c73e00fb` | `benchmark-results/stage17c/local-cut-proof-v1/ties/exports/pale-planner-square-128--A-auto--first.svg` |
| [pale-planner-square-128--combined.svg](pale-planner-square-128--combined.svg) | `7dea0103bd818d566c44a3ebabcabe8df96ad165e958ed07d95609d9c73e00fb` | `benchmark-results/stage17c/local-cut-proof-v1/ties/exports/pale-planner-square-128--combined--first.svg` |
| [pale-planner-128--A-auto.svg](pale-planner-128--A-auto.svg) | `15114cd8e8313c58a0ee417836a85e2fd92c679e257749d2bacc178f5d37afe7` | `benchmark-results/stage17c/local-cut-proof-v1/ties/exports/pale-planner-128--A-auto--first.svg` |
| [pale-planner-128--combined.svg](pale-planner-128--combined.svg) | `15114cd8e8313c58a0ee417836a85e2fd92c679e257749d2bacc178f5d37afe7` | `benchmark-results/stage17c/local-cut-proof-v1/ties/exports/pale-planner-128--combined--first.svg` |
| [pale-planner-square-128-100.png](pale-planner-square-128-100.png) | `7ebec5a5e457057a99599f456f10babc50010534380dbd6d3cff20d6bab08911` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-square-128-100.png` |
| [pale-planner-square-128-400.png](pale-planner-square-128-400.png) | `a63d621fde1cefbb87dfdbeaf21a8d2f81f3d246dd8a100fe2f6291797dcac81` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-square-128-400.png` |
| [pale-planner-square-128-1000.png](pale-planner-square-128-1000.png) | `edb368b38eace9b30ec1be6be67cd759007ff7fb27d0ffef82bd57c288377a8f` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-square-128-1000.png` |
| [pale-planner-128-100.png](pale-planner-128-100.png) | `dfab2dd3035d12fa7dd975927accb23ad6cd3d868a5c99c7dbf2d7a6900f764f` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-128-100.png` |
| [pale-planner-128-400.png](pale-planner-128-400.png) | `4fbc23293f3fc36e7746f969f5a0606fc2203cfc2cbe496f452eeabf6ab6cab3` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-128-400.png` |
| [pale-planner-128-1000.png](pale-planner-128-1000.png) | `661e4df6a287de9ec068bb6547710c8394e6c06d22e2dba0f5c43247e7ba2139` | `benchmark-results/stage17c/local-cut-proof-v1/ties/aligned-visuals/pale-planner-128-1000.png` |
