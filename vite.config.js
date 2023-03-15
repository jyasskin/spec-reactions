import { resolve } from 'path';
import { defineConfig } from 'vite';
import handlebars from 'vite-plugin-handlebars';

import issues from './issues.json' assert { type: 'json' };

export default defineConfig({
  root: 'site',
  base: './',
  plugins: [
    handlebars({
      context: {
        issues,
        updated: new Date().toISOString().split('T')[0],
      },
      helpers: {
        pretty: (url) => {
          if (!url.startsWith('https://github.com/')) {
            return url;
          }
          const parts = url.substring(19).split('/');
          if (parts.length !== 4) {
            return url;
          }
          return `${parts[0]}/${parts[1]}#${parts[3]}`;
        }
      }
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'site/index.html'),
      },
    },
  },
});
