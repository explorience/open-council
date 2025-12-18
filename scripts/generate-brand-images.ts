import sharp from "sharp"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const staticDir = path.join(__dirname, "..", "quartz", "static")

// Colors from quartz.config.ts
const colors = {
  primary: "#284b63", // secondary color - dark teal/blue
  accent: "#84a59d", // tertiary color - sage green
  dark: "#2b2b2b",
  light: "#faf8f8",
}

// Create favicon icon (512x512 for high quality, will be resized by Quartz)
async function createFavicon() {
  // Simple council building/dome icon with "OC" letters
  const iconSvg = `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1d3a4d;stop-opacity:1" />
        </linearGradient>
      </defs>

      <!-- Background circle -->
      <circle cx="256" cy="256" r="240" fill="url(#bgGrad)"/>

      <!-- Building/dome silhouette -->
      <g fill="${colors.light}" opacity="0.95">
        <!-- Main dome -->
        <ellipse cx="256" cy="200" rx="100" ry="60"/>
        <!-- Dome top -->
        <rect x="248" y="140" width="16" height="30" rx="4"/>
        <!-- Building base -->
        <rect x="156" y="200" width="200" height="120" rx="4"/>
        <!-- Columns -->
        <rect x="176" y="220" width="20" height="100"/>
        <rect x="216" y="220" width="20" height="100"/>
        <rect x="276" y="220" width="20" height="100"/>
        <rect x="316" y="220" width="20" height="100"/>
        <!-- Steps -->
        <rect x="136" y="320" width="240" height="16" rx="2"/>
        <rect x="146" y="336" width="220" height="12" rx="2"/>
        <rect x="156" y="348" width="200" height="10" rx="2"/>
      </g>

      <!-- "OC" text overlay -->
      <text x="256" y="430"
            font-family="Arial, Helvetica, sans-serif"
            font-size="80"
            font-weight="bold"
            fill="${colors.light}"
            text-anchor="middle">OC</text>
    </svg>
  `

  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(staticDir, "icon.png"))

  console.log("Created icon.png")
}

// Create social share image (1200x630)
async function createOgImage() {
  const ogSvg = `
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:#1d3a4d;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${colors.accent};stop-opacity:1" />
          <stop offset="100%" style="stop-color:#6b9b8f;stop-opacity:1" />
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="1200" height="630" fill="url(#bgGradient)"/>

      <!-- Decorative elements -->
      <circle cx="1100" cy="100" r="200" fill="${colors.accent}" opacity="0.1"/>
      <circle cx="100" cy="530" r="150" fill="${colors.accent}" opacity="0.1"/>

      <!-- Building icon (left side) -->
      <g transform="translate(100, 165)" fill="${colors.light}" opacity="0.95">
        <!-- Main dome -->
        <ellipse cx="150" cy="60" rx="80" ry="45"/>
        <!-- Dome top -->
        <rect x="144" y="15" width="12" height="25" rx="3"/>
        <!-- Building base -->
        <rect x="70" y="60" width="160" height="90" rx="3"/>
        <!-- Columns -->
        <rect x="85" y="75" width="16" height="75"/>
        <rect x="117" y="75" width="16" height="75"/>
        <rect x="167" y="75" width="16" height="75"/>
        <rect x="199" y="75" width="16" height="75"/>
        <!-- Steps -->
        <rect x="55" y="150" width="190" height="12" rx="2"/>
        <rect x="62" y="162" width="176" height="10" rx="2"/>
        <rect x="70" y="172" width="160" height="8" rx="2"/>
      </g>

      <!-- Main title -->
      <text x="420" y="260"
            font-family="Arial, Helvetica, sans-serif"
            font-size="72"
            font-weight="bold"
            fill="${colors.light}">London City Council</text>

      <!-- Subtitle -->
      <text x="420" y="330"
            font-family="Arial, Helvetica, sans-serif"
            font-size="36"
            fill="${colors.accent}">Meeting Transcripts &amp; Summaries</text>

      <!-- Accent line -->
      <rect x="420" y="360" width="400" height="4" rx="2" fill="url(#accentGrad)"/>

      <!-- Website URL -->
      <text x="420" y="420"
            font-family="Arial, Helvetica, sans-serif"
            font-size="28"
            fill="${colors.light}"
            opacity="0.8">opencouncil.xyz</text>

      <!-- Footer accent -->
      <rect x="0" y="600" width="1200" height="30" fill="${colors.accent}" opacity="0.3"/>
    </svg>
  `

  await sharp(Buffer.from(ogSvg)).png().toFile(path.join(staticDir, "og-image.png"))

  console.log("Created og-image.png")
}

async function main() {
  console.log("Generating brand images...")
  await createFavicon()
  await createOgImage()
  console.log("Done!")
}

main().catch(console.error)
