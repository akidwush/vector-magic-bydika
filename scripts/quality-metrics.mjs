// Quality measurements only; never used as an image-processing or tracing algorithm.
export function metrics(source, output, w, h, opaque = true) {
  const subject = (p, i) =>
    p[i + 3] >= 128 && (!opaque || Math.min(p[i], p[i + 1], p[i + 2]) < 240);
  let intersection = 0,
    union = 0,
    delta = 0,
    alphaDelta = 0,
    interiorBad = 0;
  const bad = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        a = subject(source, i),
        b = subject(output, i);
      if (a && b) intersection++;
      if (a || b) union++;
      alphaDelta += Math.abs(source[i + 3] - output[i + 3]);
      for (let c = 0; c < 4; c++)
        delta += Math.abs(
          c === 3
            ? source[i + c] - output[i + c]
            : (source[i + c] * source[i + 3]) / 255 -
                (output[i + c] * output[i + 3]) / 255,
        );
      // Only homogeneous orange fill, at least two pixels away from any boundary.
      if (
        x < 2 ||
        y < 2 ||
        x >= w - 2 ||
        y >= h - 2 ||
        Math.abs(source[i] - 223) > 3 ||
        Math.abs(source[i + 1] - 147) > 3 ||
        Math.abs(source[i + 2] - 94) > 3 ||
        source[i + 3] !== 255
      )
        continue;
      let uniform = true;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const j = ((y + dy) * w + x + dx) * 4;
          if (
            Math.abs(source[j] - 223) > 3 ||
            Math.abs(source[j + 1] - 147) > 3 ||
            Math.abs(source[j + 2] - 94) > 3 ||
            source[j + 3] !== 255
          )
            uniform = false;
        }
      if (
        uniform &&
        (output[i + 3] < 128 ||
          Math.min(output[i], output[i + 1], output[i + 2]) > 240)
      ) {
        bad[y * w + x] = 1;
        interiorBad++;
      }
    }
  let maxHole = 0,
    holes = 0;
  for (let p = 0; p < bad.length; p++)
    if (bad[p]) {
      const queue = [p];
      bad[p] = 0;
      for (let k = 0; k < queue.length; k++) {
        const n = queue[k],
          x = n % w,
          y = Math.floor(n / w);
        for (const j of [
          x > 0 ? n - 1 : -1,
          x < w - 1 ? n + 1 : -1,
          y > 0 ? n - w : -1,
          y < h - 1 ? n + w : -1,
        ])
          if (j >= 0 && bad[j]) {
            bad[j] = 0;
            queue.push(j);
          }
      }
      maxHole = Math.max(maxHole, queue.length);
      holes++;
    }
  const details = [
    [44, 61],
    [84, 61],
    [64, 80],
  ].map(([x, y]) => {
    const i = (Math.floor((y * h) / 128) * w + Math.floor((x * w) / 128)) * 4;
    return (
      output[i + 3] > 200 &&
      Math.max(output[i], output[i + 1], output[i + 2]) < 110
    );
  });
  const seen = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  let head = 0,
    tail = 0;
  const start = Math.floor((50 * h) / 128) * w + Math.floor((64 * w) / 128);
  if (subject(output, start * 4)) {
    queue[tail++] = start;
    seen[start] = 1;
  }
  while (head < tail) {
    const p = queue[head++],
      x = p % w,
      y = Math.floor(p / w);
    for (const j of [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ])
      if (j >= 0 && !seen[j] && subject(output, j * 4)) {
        seen[j] = 1;
        queue[tail++] = j;
      }
  }
  const earsConnected = [
    [30, 24],
    [100, 24],
  ].every(
    ([x, y]) =>
      seen[Math.floor((y * h) / 128) * w + Math.floor((x * w) / 128)] === 1,
  );
  return {
    earsConnected,
    iou: intersection / Math.max(1, union),
    mae: delta / source.length,
    alphaMae: alphaDelta / (w * h),
    interiorBad,
    maxHole,
    holes,
    details,
  };
}
export function stats(rgba) {
  const rgb = new Set();
  let zero = 0,
    partial = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    rgb.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    if (rgba[i + 3] === 0) zero++;
    else if (rgba[i + 3] < 255) partial++;
  }
  return { uniqueRGB: rgb.size, zeroAlpha: zero, partialAlpha: partial };
}
