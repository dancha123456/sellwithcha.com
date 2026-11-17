// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
// Output stays static; the Vercel adapter only powers routes that opt into
// on-demand rendering via `export const prerender = false` (e.g. /api/notify).
export default defineConfig({
      adapter: vercel(),
      // Signal House fetches /api/voice-alert with a form-style POST from its own
      // servers. Astro's default cross-site form check would 403 it. /api/notify
      // takes JSON and enforces its own origin allow-list, so this is safe.
      security: { checkOrigin: false },
      vite: {
              // Cast: the Tailwind Vite plugin's type comes from a different Vite
              // copy than Astro's bundled Vite, which trips `// @ts-check` only.
              plugins: /** @type {any} */ ([tailwindcss()]),
      },
});
