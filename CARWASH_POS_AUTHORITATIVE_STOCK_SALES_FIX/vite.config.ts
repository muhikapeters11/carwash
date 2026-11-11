import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Same project as Netlify web/mobile — desktop must share this cloud or data diverges.
const DEFAULT_SUPABASE_URL = 'https://tvjdblbxmlteszcigckj.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2amRibGJ4bWx0ZXN6Y2lnY2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MjQ5MzgsImV4cCI6MjExMDAwMDkzOH0.A5xHZivqWlyegdBcrwF_vsjFFkOVik9fODIdmnWXUcI'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isElectron = process.env.ELECTRON === 'true'

  const supabaseUrl = (env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim()
  const supabaseAnonKey = (
    env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY
  ).trim()
  const allowDemo = (env.VITE_ALLOW_DEMO || process.env.VITE_ALLOW_DEMO || 'false').trim()

  return {
    plugins: [react()],
    // Relative paths required for Electron loadFile (file://)
    base: isElectron ? './' : '/',
    define: {
      'import.meta.env.VITE_IS_ELECTRON': JSON.stringify(isElectron ? 'true' : 'false'),
      // Always bake cloud credentials so desktop matches web even without a local .env
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_ALLOW_DEMO': JSON.stringify(allowDemo),
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
  }
})
