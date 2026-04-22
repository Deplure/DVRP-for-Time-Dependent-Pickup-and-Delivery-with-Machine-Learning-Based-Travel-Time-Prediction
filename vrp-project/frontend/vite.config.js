import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        allowedHosts: true,
        // Proxy: setiap request /api/... diteruskan ke backend (server-side)
        // Aman untuk LAN & Cloudflare — port backend tidak perlu dibuka ke luar
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
                secure: false,
                // Strip /api prefix: /api/optimize → /optimize
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
        },
    },
})
