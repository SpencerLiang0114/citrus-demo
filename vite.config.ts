import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Set VITE_BASE (e.g. /repo-name/) when deploying under a subpath such as
// GitHub Pages. Defaults to '/' for Vercel, Netlify, and custom domains.
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', '').VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
}))
