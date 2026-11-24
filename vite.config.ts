import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O backend (3001) exige sessão tanto na API quanto no vídeo HLS: /media passa por ele
// e ele fala com o MediaMTX. Nenhuma porta de vídeo é acessada direto pelo navegador.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/media': 'http://127.0.0.1:3001',
    },
  },
})
