// Distribution policy is independent of all historical acceptance gates.
export function distribution(values) {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b);
  const q = (p) => a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)];
  const median =
    a.length % 2
      ? a[(a.length - 1) / 2]
      : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const dev = a.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return {
    n: a.length,
    min: a[0],
    median,
    p95: q(0.95),
    max: a.at(-1),
    mean,
    variance: a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length,
    mad:
      dev.length % 2
        ? dev[(dev.length - 1) / 2]
        : (dev[dev.length / 2 - 1] + dev[dev.length / 2]) / 2,
  };
}
