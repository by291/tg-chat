import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const libraryChunks = [
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
