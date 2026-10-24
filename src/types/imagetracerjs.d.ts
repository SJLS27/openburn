declare module 'imagetracerjs' {
  interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray | number[];
  }

  interface TraceOptions {
    numberofcolors?: number;
    colorsampling?: number;
    pathomit?: number;
    ltres?: number;
    qtres?: number;
    rightangleenhance?: boolean;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    blurradius?: number;
    blurdelta?: number;
  }

  interface ImageTracerApi {
    imagedataToSVG(imgd: ImageDataLike, options?: TraceOptions): string;
  }

  const tracer: ImageTracerApi;
  export default tracer;
}
