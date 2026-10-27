import parse from "svg-path-parser";
const sizeSvg = (s, w, h) =>
  s.replace(/<svg\b[^>]*>/, (t) =>
    t
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace("<svg", `<svg width="${w}" height="${h}"`),
  );
export async function contour(page, svg, w, h, mask) {
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map(
    (m) => {
      let start = [0, 0];
      const out = [];
      for (const c of parse.makeAbsolute(parse(m[1]))) {
        if (c.code === "M") start = [c.x, c.y];
        const p = c.code === "Z" ? start : [c.x, c.y];
        if (p.every(Number.isFinite)) out.push(p);
      }
      return out;
    },
  );
  return page.evaluate(
    ({ svg, w, h, mask, paths }) => {
      document.body.innerHTML = "";
      const node = document.createElement("div");
      node.innerHTML = svg;
      document.body.append(node);
      const root = node.querySelector("svg");
      root.setAttribute("width", w);
      root.setAttribute("height", h);
      root.style.width = w + "px";
      root.style.height = h + "px";
      const m = Uint8Array.from(atob(mask), (c) => c.charCodeAt(0)),
        mw = w * 2,
        mh = h * 2;
      const get = (x, y) =>
        x < 0 || y < 0 || x >= mw || y >= mh ? 0 : m[y * mw + x];
      const visible = (p) => {
        if (p[0] < -0.01 || p[1] < -0.01 || p[0] > w + 0.01 || p[1] > h + 0.01)
          return false;
        let zero = false,
          one = false;
        const x = Math.floor(p[0] * 2),
          y = Math.floor(p[1] * 2);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (get(x + dx, y + dy)) one = true;
            else zero = true;
          }
        return one && zero;
      };
      const points = [];
      let index = 0,
        endpoints = 0;
      for (const el of root.querySelectorAll(
        "path,circle,ellipse,rect,polygon,polyline,line",
      )) {
        const pi = el.tagName === "path" ? index++ : null;
        const maskNode = el.closest("mask");
        if (maskNode) {
          const used = [...root.querySelectorAll("[mask]")].some(
            (e) =>
              e.getAttribute("mask") === "url(#" + maskNode.id + ")" &&
              !e.hasAttribute("transform"),
          );
          if (
            !used ||
            maskNode.getAttribute("maskUnits") !== "userSpaceOnUse" ||
            maskNode.getAttribute("maskContentUnits") === "objectBoundingBox"
          )
            continue;
        } else if (el.closest("defs,clipPath")) continue;
        if (getComputedStyle(el).fill === "none") continue;
        const matrix = el.getCTM();
        if (!matrix) continue;
        const transform = (p) => {
          const q = new DOMPoint(p[0], p[1]).matrixTransform(matrix);
          return [q.x, q.y];
        };
        const len = el.getTotalLength(),
          scale = Math.max(
            Math.hypot(matrix.a, matrix.b),
            Math.hypot(matrix.c, matrix.d),
          );
        const n = Math.max(1, Math.ceil((len * scale) / 0.5));
        if (n > 120000) throw Error("Reference contour work budget");
        for (let i = 0; i <= n; i++) {
          const p = el.getPointAtLength((len * i) / n),
            q = transform([p.x, p.y]);
          if (visible(q)) points.push(q);
        }
        if (pi != null)
          for (const p of paths[pi] ?? []) {
            const q = transform(p);
            if (visible(q)) {
              points.push(q);
              endpoints++;
            }
          }
        if (points.length > 120000) throw Error("Visible contour point budget");
      }
      let framePoints = 0;
      for (let x = 0; x < mw; x++) {
        if (get(x, 0)) {
          points.push([(x + 0.5) / 2, 0]);
          framePoints++;
        }
        if (get(x, mh - 1)) {
          points.push([(x + 0.5) / 2, h]);
          framePoints++;
        }
      }
      for (let y = 0; y < mh; y++) {
        if (get(0, y)) {
          points.push([0, (y + 0.5) / 2]);
          framePoints++;
        }
        if (get(mw - 1, y)) {
          points.push([w, (y + 0.5) / 2]);
          framePoints++;
        }
      }
      return {
        points,
        endpoints,
        framePoints,
        definition:
          "Native SVG arc-length sampling and explicit transformed command endpoints; visible filled/mask silhouette with viewport clip boundaries; canonical userSpaceOnUse masks only.",
      };
    },
    {
      svg: sizeSvg(svg, w, h),
      w,
      h,
      mask: Buffer.from(mask).toString("base64"),
      paths,
    },
  );
}
