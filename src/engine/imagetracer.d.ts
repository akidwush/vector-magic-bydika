declare module "imagetracerjs" {
  const tracer: {
    imagedataToSVG(
      input: { width: number; height: number; data: Uint8ClampedArray },
      options: Record<
        string,
        number | boolean | { r: number; g: number; b: number; a: number }[]
      >,
    ): string;
  };
  export default tracer;
}
