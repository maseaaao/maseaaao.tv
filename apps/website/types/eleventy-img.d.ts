// Minimal ambient types for @11ty/eleventy-img v7 (the package ships no .d.ts).
// Only the two APIs used by the website build are described.
declare module '@11ty/eleventy-img' {
  export interface EleventyImageEntry {
    filename: string;
    format: string;
    height: number;
    outputPath: string;
    size: number;
    sourceType: string;
    srcset: string;
    url: string;
    width: number;
  }
  export type EleventyImageMetadata = Record<string, EleventyImageEntry[]>;
  export function generateHTML(
    metadata: EleventyImageMetadata,
    imgAttributes?: Record<string, string>,
    htmlOptions?: { fallback?: 'largest' | 'smallest' },
  ): string;
  export default function queueImage(
    source: string | Buffer,
    options?: Record<string, unknown>,
  ): Promise<EleventyImageMetadata>;
}
