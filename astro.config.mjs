// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Production URL — required for absolute canonical/hreflang/OG URLs and the
  // sitemap. Update this if the site is served from a different domain.
  site: 'https://subvid.app',
  // The whole app is client-side, so it ships as plain static assets. This
  // also keeps local builds working on macOS versions older than 13.5, where
  // the Cloudflare Workers runtime (workerd) cannot start.
  output: 'static',
  // The whole stylesheet is ~7 KB gzipped: inlining it removes the only
  // render-blocking request on first load.
  build: {
    inlineStylesheets: 'always'
  },
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false
    }
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', es: 'es' }
      }
    })
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['mediabunny']
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    worker: {
      format: 'es'
    }
  }
});
