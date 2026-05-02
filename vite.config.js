import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/stripe': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
