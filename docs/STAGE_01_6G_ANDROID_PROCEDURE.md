# Physical Android runtime procedure — UNVERIFIED

No physical Android device is attached to this cloud environment. Desktop mobile
emulation is not an Android CPU, memory, thermal or browser-termination test.

Use an isolated checkout and a USB-connected real device. Record model, Android
release, Chrome version, battery/charging state and thermal conditions. Build the
normal app with `./scripts/build-wasm.sh && npm run build`; run
`NEXORA_PORT=4175 node scripts/serve-dist.mjs`, then `adb reverse tcp:4175 tcp:4175`.
Open `http://127.0.0.1:4175/nexora/` in device Chrome. This uses local processing;
no uploaded image leaves the browser. Use the repository's CC0 test fixtures.

Test Triangle 128/512/1024, Wave 128/1024 and Cubic 128/1024. For each, record one
first conversion, four warm conversions, then Reset and another conversion.
Do three independent sessions, alternating fixture order. Do not discard slow
runs. Record the DOM `.result` element's `data-metrics` via USB remote DevTools:
engine, decodeMs, timings, elapsedMs, stages and WASM linear bytes. Startup,
Worker total, adapter elapsed and nested Rust stages are overlapping quantities.
Measure upload-click-to-result separately. DevTools/profiling overhead must be
identified; keep instrumented samples separate from ordinary samples.

For experimental geometry, build the same isolated checkout with Cargo feature
`large_apex`, generate its bindings into `src/engine/wasm`, and rebuild Vite.
The optional cache prototype additionally needs `runtime_cache`. Enable the app's
source-refinement and node-optimization controls. Preserve every downloaded SVG
and compare bytes against the desktop Stage 1.6F exports. Restore the normal
WASM/dist build after experiments. Never change thresholds or production flags
based solely on emulation or one favorable measurement.

Record device memory observations with `adb shell dumpsys meminfo
com.android.chrome` and distinguish Chrome aggregate memory from WASM linear
memory. Verify the UI can scroll/interact during conversion. Cancel a large
conversion, replace the input, and confirm no obsolete download appears; verify
fresh conversion and Worker reuse afterward. Record tab reloads, process deaths,
ANRs and browser termination from actual device logs. Repeat under sustained
load to identify thermal throttling. Report failures, not just successful traces.

This procedure is reproducible guidance; none of its physical-device steps has
been executed in the present cloud session.
