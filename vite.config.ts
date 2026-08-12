import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages のプロジェクトサイト (https://<user>.github.io/<repo>/) 配下でも
  // アセット解決が壊れないよう相対パスにする
  base: './',
})
