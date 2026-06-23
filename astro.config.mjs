// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
// Output stays static; the Vercel adapter only powers routes that opt into
// on-demand rendering via `export const prerender = false` (e.g. /api/notify).
export default defineConfig({
      adapter: vercel(),
      vite: {
              // Cast: the Tailwind Vite plugin's type comes from a different Vite
              // copy than Astro's bundled Vite, which trips `// @ts-check` only.
              plugins: /** @type {any} */ ([tailwindcss()]),
      },
});
