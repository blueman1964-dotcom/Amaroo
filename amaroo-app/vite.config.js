import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['Amaroo_Logo.png', 'icon-192.png', 'icon-512.png', 'favicon.svg'],
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
      },
      manifest: {
        name: 'Amaroo Vessel Manager',
        short_name: 'Amaroo',
        description: 'Vessel management for Amaroo — Clipper Explorer 50 PH',
        start_url: '/',
        display: 'standalone',
        background_color: '#F7F3EE',
        theme_color: '#0A4A52',
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/Amaroo_Logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
        share_target: {
          action: '/passage-planner',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'gpx',
                accept: ['application/gpx+xml', '.gpx'],
              },
            ],
          },
        },
      },
    }),
  ],
})
