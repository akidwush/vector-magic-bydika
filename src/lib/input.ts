export const limits = {
  fileBytes: 10 * 1024 * 1024,
  sourcePixels: 16_000_000,
  tracePixels: 2_000_000,
};
export function identify(bytes: Uint8Array): string {
  const text = (a: number, b: number) =>
    String.fromCharCode(...bytes.slice(a, b));
  if (
    bytes.length >= 24 &&
    text(0, 8) === "\x89PNG\r\n\x1a\n" &&
    text(12, 16) === "IHDR"
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  throw new Error("Format tidak didukung. Pilih PNG, JPEG, atau WebP asli.");
}
export function dimensions(
  b: Uint8Array,
  mime: string,
): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0,
    height = 0;
  if (mime === "image/png") {
    width = v.getUint32(16);
    height = v.getUint32(20);
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i++] !== 255) continue;
      let marker = b[i++];
      while (marker === 255) marker = b[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const len = v.getUint16(i);
      if (len < 2) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
        break;
      }
      i += len;
    }
  }
  if (mime === "image/webp") {
    for (let i = 12; i + 8 <= b.length;) {
      const name = String.fromCharCode(...b.slice(i, i + 4)),
        len = v.getUint32(i + 4, true),
        s = i + 8;
      if (s + len > b.length) break;
      if (name === "VP8X" && len >= 10) {
        width = 1 + b[s + 4] + (b[s + 5] << 8) + (b[s + 6] << 16);
        height = 1 + b[s + 7] + (b[s + 8] << 8) + (b[s + 9] << 16);
        break;
      }
      if (name === "VP8 " && len >= 10) {
        width = v.getUint16(s + 6, true) & 16383;
        height = v.getUint16(s + 8, true) & 16383;
        break;
      }
      if (name === "VP8L" && len >= 5) {
        const bits = v.getUint32(s + 1, true);
        width = (bits & 16383) + 1;
        height = ((bits >>> 14) & 16383) + 1;
        break;
      }
      i = s + len + (len % 2);
    }
  }
  checkDimensions(width, height);
  return { width, height };
}
export function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > limits.sourcePixels
  )
    throw new Error("Dimensi invalid atau melebihi 16 megapiksel.");
}
export async function inspectFile(file: File) {
  if (file.size === 0 || file.size > limits.fileBytes)
    throw new Error("Ukuran file harus antara 1 byte dan 10 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    mime = identify(bytes);
  if (file.type && file.type !== mime)
    throw new Error("MIME file tidak cocok dengan signature gambar.");
  return { ...dimensions(bytes, mime), mime };
}
export async function decode(file: File, allowResize: boolean) {
  const started = performance.now();
  const info = await inspectFile(file);
  const resize = info.width * info.height > limits.tracePixels;
  if (resize && !allowResize)
    throw new Error("Setujui pengecilan gambar sebelum konversi.");
  // Decode only after header caps. Native bitmap preserves EXIF orientation;
  // canvas allocation and transferred RGBA stay within the tracing cap.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    checkDimensions(bitmap.width, bitmap.height);
    if (bitmap.width * bitmap.height !== info.width * info.height)
      throw new Error("Dimensi hasil decode tidak cocok dengan header.");
    const factor = resize
      ? Math.sqrt(limits.tracePixels / (bitmap.width * bitmap.height))
      : 1;
    const width = Math.max(1, Math.floor(bitmap.width * factor));
    const height = Math.max(1, Math.floor(bitmap.height * factor));
    const canvas = document.createElement("canvas");
    let rgba: Uint8ClampedArray;
    try {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas tidak tersedia.");
      ctx.drawImage(bitmap, 0, 0, width, height);
      rgba = ctx.getImageData(0, 0, width, height).data;
    } finally {
      // Release the backing store even if drawing/readback fails on the device.
      canvas.width = canvas.height = 0;
    }
    return {
      rgba,
      width,
      height,
      sourceFormat: info.mime,
      decodeMs: performance.now() - started,
      optimize: undefined as boolean | undefined,
      sourceRefine: undefined as boolean | undefined,
      quality: undefined as
        | "auto"
        | "legacy"
        | "shared"
        | "previous"
        | "pre-source"
        | "planar"
        | "source"
        | "intelligent"
        | undefined,
    };
  } finally {
    bitmap.close();
  }
}
