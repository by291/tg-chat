import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
  plugins: [react()],
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
      output: {
        codeSplitting: {
          groups: libraryChunks,
        },
      },
    },
  },
});
