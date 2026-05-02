import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['Amaroo_Logo.png'],
      manifest: {
        name: 'Amaroo Vessel Management',
        short_name: 'Amaroo',
        description: 'Amaroo Clipper Explorer 50 vessel management app',
        theme_color: '#0A4A52',
        background_color: '#F7F3EE',
        display: 'standalone',
        icons: [
          {
            src: '/Amaroo_Logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*$/i,
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
    }),
  ],
})
