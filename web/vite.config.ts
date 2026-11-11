import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const workerEntry = 'notification-worker';
const workerPath = `/${workerEntry}.js`;
const workerSource = '/src/features/settings/notifications/notificationWorker.ts';

const libraryChunks = [
  {
    name: 'editor',
    test: /\/node_modules\/(lexical|@lexical)\//,
  },
  {
    name: 'react',
    test: /\/node_modules\/(react|react-dom|scheduler)\//,
  },
  {
    name: 'interaction',
    test: /\/node_modules\/(@ark-ui|@zag-js|@floating-ui)\//,
  },
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'tg-chat-notification-worker',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const pathname = request.url?.split('?')[0];
          if (pathname === workerPath) {
            // Keep the development worker at root so its scope matches the production bundle.
            request.url = workerSource;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/connection': {
        target: process.env.TG_CHAT_DEV_REALTIME_ORIGIN ?? 'http://127.0.0.1:8000',
        ws: true,
      },
      '/api': process.env.TG_CHAT_DEV_API_ORIGIN ?? 'http://127.0.0.1:8080',
      '/health': process.env.TG_CHAT_DEV_API_ORIGIN ?? 'http://127.0.0.1:8080',
    },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        [workerEntry]: fileURLToPath(new URL(`.${workerSource}`, import.meta.url)),
      },
      output: {
        entryFileNames: ({ name }) => {
          return name === workerEntry ? `${workerEntry}.js` : 'assets/[name]-[hash].js';
        },
        codeSplitting: {
          groups: libraryChunks,
        },
      },
    },
  },
});
