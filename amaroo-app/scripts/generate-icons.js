/**
 * Generate PWA icons for Amaroo app.
 *
 * Prerequisites:
 *   npm install -D sharp
 *
 * Usage:
 *   node scripts/generate-icons.js
 *
 * Outputs:
 *   public/icon-192.png
 *   public/icon-512.png
 */

import sharp from 'sharp'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')

if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })

// Anchor SVG path on a teal background
function svgIcon(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0A4A52" rx="12"/>
  <!-- Anchor ring -->
  <circle cx="50" cy="22" r="9" fill="none" stroke="white" stroke-width="5"/>
  <!-- Anchor shaft -->
  <line x1="50" y1="31" x2="50" y2="72" stroke="white" stroke-width="5" stroke-linecap="round"/>
  <!-- Anchor crossbar -->
  <line x1="28" y1="44" x2="72" y2="44" stroke="white" stroke-width="5" stroke-linecap="round"/>
  <!-- Anchor flukes -->
  <path d="M 30 72 Q 50 86 70 72" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/>
  <circle cx="30" cy="72" r="5" fill="white"/>
  <circle cx="70" cy="72" r="5" fill="white"/>
</svg>`)
}

const logoPath = join(publicDir, 'Amaroo_Logo.png')

async function makeIcon(size, outFile) {
  if (existsSync(logoPath)) {
    // Use the existing logo, fit inside teal background
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 10, g: 74, b: 82, alpha: 1 },
      },
    })
      .composite([
        {
          input: await sharp(logoPath)
            .resize(Math.round(size * 0.75), Math.round(size * 0.75), {
              fit: 'inside',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer(),
          gravity: 'center',
        },
      ])
      .png()
      .toFile(outFile)
  } else {
    // Fallback: anchor SVG
    await sharp(svgIcon(size)).png().toFile(outFile)
  }
  console.log(`✓ ${outFile}`)
}

console.log('Generating PWA icons…')
await makeIcon(192, join(publicDir, 'icon-192.png'))
await makeIcon(512, join(publicDir, 'icon-512.png'))
console.log('Done. Icons written to public/')
