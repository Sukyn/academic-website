// @ts-check
import { provider as google } from "astro/assets/fonts/providers/google";

/** @type {typeof google} */
export const provider = (options) => {
  const original = google(options);
  return Object.assign(
    async (/** @type {Parameters<typeof original>[0]} */ context) => {
      const initialized = await original(context);
      if (!initialized) return;
      return {
        ...initialized,
        /** @type {typeof initialized.resolveFont} */
        resolveFont: async (...args) => {
          const result = await initialized.resolveFont(...args);
          if (!result) return;
          const fonts = result.fonts.map((font) => {
            if (font.unicodeRange?.length || !font.meta?.priority) return font;
            // Match the modern subsets' coverage: a full legacy face otherwise
            // triggers a download even for symbols the font cannot render.
            const ranges = result.fonts
              .filter((other) => !other.meta?.priority &&
                other.weight === font.weight && other.style === font.style)
              .flatMap((other) => other.unicodeRange ?? []);
            return ranges.length
              ? { ...font, unicodeRange: [...new Set(ranges)] }
              : font;
          });
          // CSS checks overlapping faces last-first. Put legacy full fonts before
          // the WOFF2 subsets so modern browsers use the smaller preloaded files.
          return {
            ...result,
            fonts: fonts.sort(
              (a, b) => (b.meta?.priority ?? 0) - (a.meta?.priority ?? 0),
            ),
          };
        },
      };
    },
    { _name: `${original._name}-preferred-formats` },
  );
};
