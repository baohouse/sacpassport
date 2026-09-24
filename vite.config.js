import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import cultures from './data/cultures.json';
import { eventJsonLd } from './src/event-schema.js';

function eventSchemaPlugin() {
  const json = JSON.stringify(eventJsonLd(cultures)).replace(/</g, '\\u003c');
  const tag = `<script type="application/ld+json">${json}</script>`;
  return {
    name: 'event-schema',
    transformIndexHtml(html) {
      if (html.includes('application/ld+json')) return html;
      return html.replace('</head>', `    ${tag}\n  </head>`);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [
    eventSchemaPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'robots.txt',
        'sitemap.xml',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'SacPassport',
        short_name: 'SacPassport',
        description: 'Where would you like to staycation?',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#e7f3fb',
        theme_color: '#1578b0',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,txt,xml,webmanifest}'],
        globIgnores: ['**/flyers/**', '**/og.png'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/flyers\/.*\.(?:png|jpe?g|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'flyers',
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
  },
});
