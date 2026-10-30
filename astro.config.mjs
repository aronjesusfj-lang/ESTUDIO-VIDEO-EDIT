// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// Cloudflare's local Workers runtime requires macOS 13.5+. Keep the production
// adapter for builds/deploys, but allow the browser-only app to run locally on
// older macOS releases without starting workerd.
const localDevelopment = process.env.SUBVID_LOCAL_DEV === '1';

// https://astro.build/config
export default defineConfig({
  // Production URL — required for absolute canonical/hreflang/OG URLs and the
  // sitemap. Update this if the site is served from a different domain.
  site: 'https://subvid.app',
  output: localDevelopment ? 'static' : 'server',
  // The whole stylesheet is ~7 KB gzipped: inlining it removes the only
  // render-blocking request on first load.
  build: {
    inlineStylesheets: 'always'
  },
  // The Cloudflare adapter targets the Workers runtime for edge middleware,
  // while the public pages are emitted as prerendered static assets.
  ...(localDevelopment ? {} : { adapter: cloudflare() }),
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
