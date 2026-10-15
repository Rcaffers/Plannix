import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const authMode = loadEnv(mode, process.cwd(), 'VITE_').VITE_PLANNIX_AUTH_MODE || 'bearer';
  if (!['bearer', 'server'].includes(authMode)) throw new Error('VITE_PLANNIX_AUTH_MODE is invalid.');
  const serverManaged = authMode === 'server';
  return {
  plugins: [react(), { name:'emit-auth-mode-contract', generateBundle() {
    this.emitFile({ type:'asset', fileName:'auth-mode.json',
      source:JSON.stringify({ version:1, authMode }) });
  } }, ...(serverManaged ? [{ name:'omit-browser-supabase-auth', enforce:'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase.js')) {
        return path.resolve('src/lib/serverAuthSupabaseStub.js');
      }
      return null;
    },
  }] : [])],
  server: {
    proxy: {
      '/__stage3/auth': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
      '/auth': {
        target: 'http://localhost:4000',
        changeOrigin: !serverManaged,
      },
      '/holidays': {
        target: 'http://localhost:4000',
        changeOrigin: !serverManaged,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: !serverManaged,
      },
    },
  },
  };
});
