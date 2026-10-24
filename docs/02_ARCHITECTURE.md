# Target architecture (not yet implemented)

```text
PNG/JPEG/WebP
    |
    v
Browser file validation & decode
    |
    v
Decode ImageData / RGBA   [size + memory limit]
    |
    v
TraceEngine interface
    +-- VTracer Rust/WASM adapter (preferred)
    +-- ImageTracerJS adapter (fallback)
    |
    v
SVG validation and optional safe optimization
    |
    +--> sandboxed/safe vector preview
    |
    +--> Blob download (SVG + preserved viewBox)
```

## Runtime separation
- UI: TypeScript + React + Vite in Stage 1, unless repository requirements justify another static-build stack.
- Workers: computational tracing isolated from responsive UI, with request IDs to reject stale results.
- Adapter: normalized inputs, options, output, provenance, error types.
- Static hosting: final HTML, JS, CSS, and `.wasm` files published through GitLab Pages, without backend.
- No secrets in browser. No image transmission to remote endpoints by default.

## Proposed TypeScript API (design sketch only)
```ts
type Preset = "logo" | "illustration" | "photo";
type TraceInput = { rgba: Uint8ClampedArray; width: number; height: number };
type TraceResult = { svg: string; engine: string; elapsedMs: number };
interface TraceEngine {
  readonly id: string;
  trace(input: TraceInput, preset: Preset, signal?: AbortSignal): Promise<TraceResult>;
}
```

Above signatures are advisory. Actual upstream capability and cancellation support must be verified; do not fabricate cancellation support if a library cannot abort.

## WASM deployment pitfalls
- Ensure `.wasm` files are included in the built artifact and served using `application/wasm` when relevant.
- Handle bundler asset URLs and GitLab project-subpath base URLs correctly; avoid absolute `/engine.wasm` paths on project Pages.
- Build both desktop and mobile smoke coverage.
- Record fallback behavior if WebAssembly or memory availability fails.

## Security and quality
- Validate file signatures and decoded dimensions, not only extensions.
- Limit megapixels and allocated RGBA buffers.
- Treat resulting SVG as potentially untrusted; never insert arbitrary `innerHTML`.
- Avoid silent lossy downscaling. Inform user if any limit is applied.
- Clean up object URLs, workers, canvases and decoded buffers.
