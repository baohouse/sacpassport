import { defineConfig } from 'vite';
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
  plugins: [eventSchemaPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
  },
});
