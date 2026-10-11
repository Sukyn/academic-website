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
          // CSS checks overlapping faces last-first. Put legacy full fonts before
          // the WOFF2 subsets so modern browsers use the smaller preloaded files.
          return {
            ...result,
            fonts: [...result.fonts].sort(
              (a, b) => (b.meta?.priority ?? 0) - (a.meta?.priority ?? 0),
            ),
          };
        },
      };
    },
    { _name: `${original._name}-preferred-formats` },
  );
};
