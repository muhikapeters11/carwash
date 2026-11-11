import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  plugins: [react()],
  base: isElectron ? './' : '/',
  define: {
    // Baked into the desktop bundle so login works offline / first launch
    'import.meta.env.VITE_IS_ELECTRON': JSON.stringify(isElectron ? 'true' : 'false'),
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
