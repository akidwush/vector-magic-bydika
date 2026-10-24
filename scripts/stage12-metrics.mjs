// Measurements only. Never imported into tracing runtime.
function mask(rgba, w, h, kind) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    const [r, g, b, a] = rgba.slice(i * 4, i * 4 + 4);
    m[i] =
      a > 127 &&
      (kind === "subject"
        ? Math.min(r, g, b) < 240
        : kind === "eyes"
          ? Math.max(r, g, b) < 110
          : r > 230 && g > 190 && b > 140)
        ? 1
        : 0;
  }
  return m;
}
function boundary(m, w, h) {
  const a = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]))
        a.push([x, y]);
    }
  return a;
}
function iou(a, b) {
  let x = 0,
    u = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) x++;
    if (a[i] || b[i]) u++;
  }
  return x / Math.max(1, u);
}
function lab(r, g, b) {
  const linear = (x) => {
    x /= 255;
    return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
  };
  r = linear(r);
  g = linear(g);
  b = linear(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 841) / 108 + 4 / 29);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047),
    y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b),
    z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function geometryMetrics(gt, out, w, h, cat = true) {
  const a = mask(gt, w, h, "subject"),
    b = mask(out, w, h, "subject"),
    ae = boundary(a, w, h),
    be = boundary(b, w, h);
  const distance = (points, target) => {
    let hit = 0,
      sum = 0;
    for (const [x, y] of points) {
      let d = 8;
      for (let dy = -8; dy <= 8; dy++)
        for (let dx = -8; dx <= 8; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (
            xx >= 0 &&
            yy >= 0 &&
            xx < w &&
            yy < h &&
            target[yy * w + xx] &&
            Math.hypot(dx, dy) < d
          )
            d = Math.hypot(dx, dy);
        }
      sum += d;
      if (d <= 1) hit++;
    }
    return {
      mean: sum / Math.max(1, points.length),
      hit: hit / Math.max(1, points.length),
    };
  };
  const am = new Uint8Array(w * h),
    bm = new Uint8Array(w * h);
  for (const [x, y] of ae) am[y * w + x] = 1;
  for (const [x, y] of be) bm[y * w + x] = 1;
  const ab = distance(ae, bm),
    ba = distance(be, am);
  let mse = 0,
    sy = 0,
    ty = 0,
    ss = 0,
    tt = 0,
    st = 0,
    de = 0,
    n = 0;
  for (let i = 0; i < w * h; i++) {
    const y =
        0.2126 * gt[i * 4] + 0.7152 * gt[i * 4 + 1] + 0.0722 * gt[i * 4 + 2],
      z =
        0.2126 * out[i * 4] + 0.7152 * out[i * 4 + 1] + 0.0722 * out[i * 4 + 2];
    sy += y;
    ty += z;
    ss += y * y;
    tt += z * z;
    st += y * z;
    for (let c = 0; c < 3; c++) mse += (gt[i * 4 + c] - out[i * 4 + c]) ** 2;
    if (i % 16 === 0 && a[i]) {
      const l = lab(...gt.slice(i * 4, i * 4 + 3)),
        m = lab(...out.slice(i * 4, i * 4 + 3));
      de += Math.hypot(l[0] - m[0], l[1] - m[1], l[2] - m[2]);
      n++;
    }
  }
  const total = w * h,
    my = sy / total,
    mz = ty / total,
    vy = ss / total - my * my,
    vz = tt / total - mz * mz,
    cov = st / total - my * mz;
  const features = {};
  if (cat) {
    const ga = mask(gt, w, h, "eyes"),
      oa = mask(out, w, h, "eyes");
    const roi = (m, x, y, rx, ry) => {
      const v = [];
      for (
        let yy = Math.floor(((y - ry) * h) / 128);
        yy < Math.ceil(((y + ry) * h) / 128);
        yy++
      )
        for (
          let xx = Math.floor(((x - rx) * w) / 128);
          xx < Math.ceil(((x + rx) * w) / 128);
          xx++
        )
          v.push(m[yy * w + xx]);
      return v;
    };
    features.eyeIoU = [44, 84].map((x) =>
      iou(roi(ga, x, 61, 9, 9), roi(oa, x, 61, 9, 9)),
    );
    features.eyeRadialCV = [44, 84].map((x) => {
      const e = boundary(oa, w, h).filter(
        ([xx, yy]) =>
          Math.abs(xx - (x * w) / 128) < (9 * w) / 128 &&
          Math.abs(yy - (61 * h) / 128) < (9 * h) / 128,
      );
      const cx = e.reduce((s, p) => s + p[0], 0) / Math.max(1, e.length),
        cy = e.reduce((s, p) => s + p[1], 0) / Math.max(1, e.length);
      const radii = e.map(([xx, yy]) => Math.hypot(xx - cx, yy - cy)),
        mean = radii.reduce((s, d) => s + d, 0) / Math.max(1, radii.length);
      return (
        Math.sqrt(
          radii.reduce((s, d) => s + (d - mean) ** 2, 0) /
            Math.max(1, radii.length),
        ) / Math.max(0.001, mean)
      );
    });
    const gm = mask(gt, w, h, "muzzle"),
      om = mask(out, w, h, "muzzle");
    features.muzzleIoU = iou(roi(gm, 64, 83, 33, 24), roi(om, 64, 83, 33, 24));
    features.earTipDistance = [
      [30, 18],
      [101, 18],
    ].map(([x, y]) =>
      Math.min(
        ...be.map(([xx, yy]) =>
          Math.hypot(xx - (x * w) / 128, yy - (y * h) / 128),
        ),
      ),
    );
  }
  return {
    boundaryF1: (2 * ab.hit * ba.hit) / Math.max(0.000001, ab.hit + ba.hit),
    symmetricContourDistance: (ab.mean + ba.mean) / 2,
    silhouetteIoU: iou(a, b),
    rgbRMSE: Math.sqrt(mse / (total * 3)),
    globalLumaSSIM:
      ((2 * my * mz + 6.5025) * (2 * cov + 58.5225)) /
      ((my * my + mz * mz + 6.5025) * (vy + vz + 58.5225)),
    sampledDeltaE76: de / Math.max(1, n),
    ...features,
  };
}
