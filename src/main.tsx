import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TraceClient } from "./engine/client";
import { presets, type Preset, type TraceResult } from "./engine/types";
import { decode, inspectFile, limits } from "./lib/input";
import { validateSvg, svgBlob, exportName } from "./lib/svg";
import "./style.css";
function App() {
  const client = useRef(new TraceClient()),
    generation = useRef(0);
  const [file, setFile] = useState<File>(),
    [info, setInfo] = useState<{ width: number; height: number }>(),
    [original, setOriginal] = useState(""),
    [vector, setVector] = useState("");
  const [preset, setPreset] = useState<Preset>("illustration"),
    [preferred, setPreferred] = useState<"auto" | "fallback">("auto");
  const [quality, setQuality] = useState<
    | "auto"
    | "legacy"
    | "shared"
    | "previous"
    | "pre-source"
    | "planar"
    | "intelligent"
    | "source"
  >("auto");
  const [result, setResult] = useState<
      TraceResult & {
        width: number;
        height: number;
        pathCount: number;
        bytes: number;
        totalMs: number;
        decodeMs: number;
      }
    >(),
    [status, setStatus] = useState("idle"),
    [error, setError] = useState(""),
    [resize, setResize] = useState(false);
  const [mode, setMode] = useState("side"),
    [slider, setSlider] = useState(50),
    [zoom, setZoom] = useState(1);
  useEffect(
    () => () => {
      client.current.cancel();
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (original) URL.revokeObjectURL(original);
    },
    [original],
  );
  useEffect(
    () => () => {
      if (vector) URL.revokeObjectURL(vector);
    },
    [vector],
  );
  const busy = status === "loading" || status === "tracing";
  function clear(keepIdleWorker = false) {
    generation.current++;
    client.current.cancel(keepIdleWorker);
    setFile(undefined);
    setInfo(undefined);
    setOriginal("");
    setVector("");
    setResult(undefined);
    setStatus("idle");
    setError("");
    setResize(false);
    setZoom(1);
  }
  async function select(next?: File) {
    clear(true);
    if (!next) return;
    const id = generation.current;
    setStatus("loading");
    try {
      const details = await inspectFile(next);
      if (id !== generation.current) return;
      setInfo(details);
      setFile(next);
      setOriginal(URL.createObjectURL(next));
      setStatus("idle");
    } catch (e) {
      if (id === generation.current) {
        setError(String(e));
        setStatus("error");
      }
    }
  }
  async function convert() {
    if (!file || busy) return;
    const id = ++generation.current;
    const started = performance.now();
    setError("");
    setResult(undefined);
    setVector("");
    setStatus("loading");
    try {
      const input = await decode(file, resize);
      if (id !== generation.current) return;
      const { width, height } = input;
      setStatus("tracing");
      input.quality = quality;
      const traced = await client.current.run(input, preset, preferred);
      if (id !== generation.current) return;
      const valid = validateSvg(traced.svg);
      if (valid.width !== width || valid.height !== height)
        throw new Error("Dimensi hasil tidak cocok dengan input.");
      const blob = svgBlob(valid.svg);
      setVector(URL.createObjectURL(blob));
      setResult({
        ...traced,
        svg: valid.svg,
        width,
        height,
        pathCount: valid.pathCount,
        bytes: blob.size,
        totalMs: performance.now() - started,
        decodeMs: input.decodeMs,
      });
      setStatus("done");
    } catch (e) {
      if (id === generation.current) {
        setError(
          e instanceof Error
            ? e.message
            : typeof e === "object" && e && "message" in e
              ? String(e.message)
              : String(e),
        );
        setStatus("error");
      }
    }
  }
  function cancel() {
    generation.current++;
    client.current.cancel();
    setStatus("cancelled");
  }
  const needsResize = !!info && info.width * info.height > limits.tracePixels;
  return (
    <>
      <header>
        <a className="brand" href="./" aria-label="NEXORA beranda">
          <span className="brandmark">N</span>NEXORA{" "}
          <small>VECTOR ENGINE</small>
        </a>
        <span className="local">● Lokal di perangkat</span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">RASTER → VECTOR / TAHAP 01</p>
          <h1>
            Bentuk baru.
            <br />
            <span>Detail milik Anda.</span>
          </h1>
          <p>
            Ubah gambar menjadi SVG yang dapat diedit.
            <br />
            Tanpa akun. Tanpa unggahan. Sepenuhnya di browser.
          </p>
        </section>
        <div className="workspace">
          <aside>
            <section className="panel">
              <h2>
                <span>01</span> Pilih gambar
              </h2>
              <label
                className="drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void select(e.dataTransfer.files[0]);
                }}
              >
                <strong>＋ Pilih atau letakkan gambar</strong>
                <small>PNG, JPEG, WebP · maks. 10 MiB</small>
                <input
                  aria-label="Pilih gambar"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    void select(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {file && (
                <p className="fileinfo">
                  {file.name}
                  <br />
                  {info?.width} × {info?.height} px{" "}
                  <button className="text" onClick={() => clear()}>
                    Reset
                  </button>
                </p>
              )}
              {needsResize && (
                <label className="notice">
                  <input
                    type="checkbox"
                    checked={resize}
                    onChange={(e) => setResize(e.target.checked)}
                  />{" "}
                  Setujui pengecilan ke ≤2 MP. Detail dapat berkurang. Ukuran
                  efektif:{" "}
                  {Math.floor(
                    info!.width *
                      Math.sqrt(
                        limits.tracePixels / (info!.width * info!.height),
                      ),
                  )}{" "}
                  ×{" "}
                  {Math.floor(
                    info!.height *
                      Math.sqrt(
                        limits.tracePixels / (info!.width * info!.height),
                      ),
                  )}{" "}
                  px.
                </label>
              )}
            </section>
            <section className="panel">
              <h2>
                <span>02</span> Atur karakter
              </h2>
              <fieldset disabled={busy}>
                <legend className="sr">Preset tracing</legend>
                {(Object.keys(presets) as Preset[]).map((key) => (
                  <label
                    className={`preset ${preset === key ? "selected" : ""}`}
                    key={key}
                  >
                    <input
                      type="radio"
                      name="preset"
                      value={key}
                      checked={preset === key}
                      onChange={() => {
                        setPreset(key);
                        if (key === "photo") setQuality("auto");
                      }}
                    />
                    <span>
                      <strong>{presets[key].title}</strong>
                      <small>{presets[key].description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label>
                Kontur
                <select
                  aria-label="Profil kontur"
                  disabled={busy || preset === "photo"}
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as typeof quality)}
                >
                  <option value="auto">Otomatis · rekonstruksi kontur</option>
                  <option value="pre-source">Pembanding Auto lama</option>
                  <option value="previous">Baseline sebelum subpixel</option>
                  <option value="legacy">Baseline Stage 1.1</option>
                  <option value="source">Rekonstruksi bentuk</option>
                  <option value="intelligent">Corner & Bézier · uji</option>
                  <option value="planar">
                    Shared edge · locked graph (eksperimental)
                  </option>
                  <option value="shared">Mosaic upstream · pembanding</option>
                </select>
              </label>
              <button
                className="convert"
                disabled={!file || busy || (needsResize && !resize)}
                onClick={() => void convert()}
              >
                {busy ? "Memproses…" : "Konversi ke SVG ↗"}
              </button>
              {busy && <button onClick={cancel}>Batalkan</button>}
              <p role="status" aria-live="polite" className="status">
                {
                  {
                    idle: "Siap saat Anda siap.",
                    loading: "Membaca gambar…",
                    tracing: "Tracing di worker…",
                    done: "SVG siap diperiksa.",
                    error: "Konversi belum berhasil.",
                    cancelled: "Konversi dibatalkan.",
                  }[status]
                }
              </p>
              {error && (
                <p role="alert" className="notice">
                  {error}
                </p>
              )}
            </section>
            <details className="diagnostics">
              <summary>Engine & privasi</summary>
              <p>
                Utama: VTracer 1.0.0-alpha.4 / WASM. Fallback: ImageTracerJS.
                Gambar tidak dikirim ke server.
              </p>
              <label>
                Engine
                <select
                  aria-label="Engine"
                  value={preferred}
                  disabled={busy}
                  onChange={(e) =>
                    setPreferred(e.target.value as "auto" | "fallback")
                  }
                >
                  <option value="auto">Otomatis · VTracer utama</option>
                  <option value="fallback">ImageTracerJS · baseline</option>
                </select>
              </label>
              <p>
                Batas: sumber 16 MP, tracing 2 MP; RGBA efektif ≤8 MB, memori
                engine tambahan dapat jauh lebih besar. Alpha parsial perlu
                ditinjau. Photo merupakan baseline.
              </p>
            </details>
          </aside>
          <section className="panel viewer">
            <div className="toolbar">
              <h2>
                <span>03</span> Periksa hasil
              </h2>
              <div className="modes">
                <button
                  aria-pressed={mode === "side"}
                  onClick={() => setMode("side")}
                >
                  Berdampingan
                </button>
                <button
                  aria-pressed={mode === "overlay"}
                  onClick={() => setMode("overlay")}
                >
                  Slider
                </button>
              </div>
            </div>
            {original ? (
              <>
                <div className="zoom">
                  <button
                    aria-label="Perkecil"
                    onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  >
                    −
                  </button>
                  <button onClick={() => setZoom(1)}>Fit</button>
                  <button
                    aria-label="Perbesar"
                    onClick={() => setZoom(Math.min(4, zoom + 0.25))}
                  >
                    ＋
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                </div>
                <div className="viewport">
                  <div
                    className={`compare ${mode}`}
                    style={{ width: `${zoom * 100}%` }}
                  >
                    {mode === "side" ? (
                      <>
                        <figure>
                          <figcaption>ORIGINAL</figcaption>
                          <img src={original} alt="Gambar asli" />
                        </figure>
                        <figure>
                          <figcaption>VECTOR</figcaption>
                          {vector ? (
                            <img src={vector} alt="Hasil vektor" />
                          ) : (
                            <p className="waiting">
                              Hasil SVG akan tampil di sini.
                            </p>
                          )}
                        </figure>
                      </>
                    ) : (
                      <div className="overlaystage">
                        <img src={original} alt="Gambar asli" />
                        {vector && (
                          <img
                            className="vectoroverlay"
                            src={vector}
                            alt="Hasil vektor"
                            style={{
                              clipPath: `inset(0 ${100 - slider}% 0 0)`,
                            }}
                          />
                        )}
                        <div
                          className="divider"
                          style={{ left: `${slider}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {mode === "overlay" && (
                  <label className="slider">
                    Batas original / vector
                    <input
                      aria-label="Batas perbandingan"
                      type="range"
                      min="0"
                      max="100"
                      value={slider}
                      onChange={(e) => setSlider(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            ) : (
              <div className="empty">
                <div className="emptyicon">◇</div>
                <h3>Dari piksel ke kemungkinan.</h3>
                <p>
                  Pilih gambar untuk memulai.
                  <br />
                  Hasil asli dan vektor tampil bersama di sini.
                </p>
                <span>01 UPLOAD ── 02 CONVERT ── 03 INSPECT</span>
              </div>
            )}
            {result && (
              <div
                className="result"
                data-metrics={JSON.stringify({
                  engine: result.engine,
                  decodeMs: result.decodeMs,
                  traceMs: result.elapsedMs,
                  ...result.timings,
                  ...result.stages,
                  profile: result.profile,
                  coverage: result.coverage,
                  topology: result.topology,
                  corners: result.corners,
                  sourceModels: result.sourceModels,
                  transitions: result.transitions,
                  diagnostics: result.diagnostics,
                })}
              >
                <div>
                  <strong>
                    {result.engine} · {result.version}
                  </strong>
                  <p>
                    {result.preset}{" "}
                    {result.effectivePrecision &&
                      `· precision ${result.effectivePrecision}`}{" "}
                    · {result.width} × {result.height} px ·{" "}
                    {result.elapsedMs.toFixed(0)} ms trace ·{" "}
                    {result.totalMs.toFixed(0)} ms total
                    <br />
                    {(result.bytes / 1024).toFixed(1)} KiB · {result.pathCount}{" "}
                    paths
                  </p>
                  {result.diagnostics && (
                    <details>
                      <summary>Diagnostik input & waktu</summary>
                      <p>
                        {result.diagnostics.classification} · {result.profile}
                        <br />
                        Alpha parsial{" "}
                        {(
                          result.diagnostics.alphaPartialFraction * 100
                        ).toFixed(2)}
                        % · {result.diagnostics.dominantColors} warna dominan
                        (95%)
                        <br />
                        Edge blend{" "}
                        {result.diagnostics.edgeBlendScore.toFixed(2)} · noise{" "}
                        {result.diagnostics.noiseScore.toFixed(2)} ·{" "}
                        {result.diagnostics.megapixels.toFixed(3)} MP ·{" "}
                        {result.diagnostics.sourceFormat}
                        <br />
                        {result.coverage && (
                          <>
                            Coverage fits: {result.coverage.accepted} diterima /{" "}
                            {result.coverage.rejected} ditolak · sRGB{" "}
                            {result.coverage.srgb} / linear{" "}
                            {result.coverage.linear}
                            <br />
                          </>
                        )}
                        {result.topology && (
                          <>
                            <span>
                              Graph: {result.topology.faces} face ·{" "}
                              {result.topology.shared} shared edge · drift{" "}
                              {result.topology.maxDrift.toFixed(3)} px ·{" "}
                              {result.topology.repaired} repair
                              {result.topology.pixelFallback
                                ? " · pixel fallback"
                                : ""}
                            </span>
                            <br />
                          </>
                        )}
                        {result.transitions && (
                          <>
                            Sampel lokal: interior {result.transitions.interior}
                            , edge dua warna {result.transitions.twoColorEdges},
                            ambigu/warna ketiga{" "}
                            {result.transitions.thirdOrAmbiguous}
                            <br />
                          </>
                        )}
                        Decode {result.decodeMs.toFixed(1)} ms · startup{" "}
                        {result.timings?.startupMs.toFixed(1)} ms (
                        {result.timings?.warm ? "warm" : "cold"})<br />
                        Segmentasi{" "}
                        {result.stages?.segmentationMs.toFixed(1) ?? "N/A"} ms ·
                        fitting/warna/optimasi{" "}
                        {result.stages?.postprocessMs.toFixed(1) ?? "N/A"} ms
                        <br />
                        Coverage{" "}
                        {result.stages?.refinementMs?.toFixed(1) ?? "N/A"} ms ·
                        Alpha {result.stages?.alphaMs?.toFixed(1) ?? "N/A"} ms ·
                        SVG export{" "}
                        {result.stages?.exportMs?.toFixed(1) ?? "N/A"} ms
                      </p>
                    </details>
                  )}
                </div>
                <a
                  className="download"
                  href={vector}
                  download={exportName(file!.name)}
                >
                  Download SVG ↓
                </a>
                {result.warning && <p className="notice">{result.warning}</p>}
              </div>
            )}
          </section>
        </div>
        <footer>
          <span>NEXORA / BUILT FOR YOUR IDEAS</span>
          <span>Baseline open-source · Bukan afiliasi Vector Magic</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
