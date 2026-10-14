// gifenc 1.0.3 does not include declarations in its published package.
declare module 'gifenc' {
  type Palette = number[][];
  type Format = 'rgb444' | 'rgb565' | 'rgba4444';
  export function quantize(pixels: Uint8Array | Uint8ClampedArray, colors: number, options?: { format?: Format }): Palette;
  export function applyPalette(pixels: Uint8Array | Uint8ClampedArray, palette: Palette, format?: Format): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(pixels: Uint8Array, width: number, height: number, options: {
      palette?: Palette; delay: number; colorDepth?: number;
      transparent?: boolean; transparentIndex?: number; dispose?: number;
    }): void;
    finish(): void;
    bytesView(): Uint8Array;
  };
}
