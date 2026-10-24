const elements = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "title",
  "desc",
]);
const attributes = new Set([
  "desc",
  "xmlns",
  "version",
  "width",
  "height",
  "viewBox",
  "fill",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "d",
  "transform",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "id",
]);
export function validateSvg(svg: string) {
  if (svg.length > 32 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(svg))
    throw new Error("SVG terlalu besar atau berisi deklarasi terlarang.");
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml"),
    root = doc.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    doc.querySelector("parsererror")
  )
    throw new Error("SVG tidak valid.");
  for (const el of Array.from(root.querySelectorAll("*")).concat(root)) {
    if (!elements.has(el.localName) || el.namespaceURI !== root.namespaceURI)
      throw new Error("SVG berisi elemen tidak aman.");
    for (const attr of Array.from(el.attributes))
      if (
        !attributes.has(attr.name) ||
        /url\s*\(|javascript:|data:|[<>]/i.test(attr.value)
      )
        throw new Error("SVG berisi atribut tidak aman.");
  }
  const width = Number(root.getAttribute("width")),
    height = Number(root.getAttribute("height"));
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Dimensi SVG tidak valid.");
  const box = root.getAttribute("viewBox");
  if (box) {
    const n = box.trim().split(/[ ,]+/).map(Number);
    if (
      n.length !== 4 ||
      n.some((x) => !Number.isFinite(x)) ||
      n[2] <= 0 ||
      n[3] <= 0
    )
      throw new Error("viewBox tidak valid.");
  } else root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const geometry = Array.from(
    root.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line"),
  );
  if (
    !geometry.length ||
    !geometry.some(
      (el) =>
        el.localName !== "path" ||
        (el.getAttribute("d") ?? "").trim().length > 0,
    )
  )
    throw new Error("SVG tidak memiliki geometri.");
  const pathCount = root.querySelectorAll("path").length;
  return {
    svg: new XMLSerializer().serializeToString(root),
    width,
    height,
    pathCount,
  };
}
export function exportName(name: string) {
  return `${name.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}_-]/gu, "_") || "nexora"}-nexora.svg`;
}
export function svgBlob(svg: string) {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}
