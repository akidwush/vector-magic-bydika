declare module "imagetracerjs" {
  const tracer: {
    imagedataToSVG(
      input: { width: number; height: number; data: Uint8ClampedArray },
      options: Record<string, number | boolean>,
    ): string;
  };
  export default tracer;
}
