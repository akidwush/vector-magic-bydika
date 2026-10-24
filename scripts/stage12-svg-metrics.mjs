import parse from "svg-path-parser";
export function svgPoints(svg) {
  let anchors = 0,
    controls = 0,
    paths = 0;
  for (const match of svg.matchAll(/\sd="([^"]+)"/g)) {
    paths++;
    for (const segment of parse(match[1])) {
      if (segment.code.toUpperCase() !== "Z") anchors++;
      if (segment.x1 !== undefined) controls++;
      if (segment.x2 !== undefined) controls++;
    }
  }
  return { paths, anchorEndpoints: anchors, controlPoints: controls };
}
