/**
 * Throwaway script: generate a 1600x1200 test PNG for the upload smoke test.
 * Lives in the project so `bun run` resolves `sharp` from local node_modules.
 */
import sharp from 'sharp'

const img = await sharp({
  create: {
    width: 1600,
    height: 1200,
    channels: 4,
    background: { r: 80, g: 30, b: 150, alpha: 1 },
  },
}).composite([
  {
    input: Buffer.from(
      `<svg width="1600" height="1200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="g" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stop-color="#ff80ff" />
            <stop offset="100%" stop-color="#3010a0" />
          </radialGradient>
        </defs>
        <rect width="1600" height="1200" fill="url(#g)" />
        <circle cx="800" cy="600" r="320" fill="white" opacity="0.6"/>
        <text x="800" y="600" text-anchor="middle" font-size="60" fill="black">SMOKE TEST</text>
      </svg>`,
    ),
    top: 0,
    left: 0,
  },
]).png().toBuffer()
await Bun.write('/tmp/smoke-test-1600x1200.png', img)
console.log('Wrote', img.byteLength, 'bytes to /tmp/smoke-test-1600x1200.png')
