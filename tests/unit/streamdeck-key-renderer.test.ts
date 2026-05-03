import { describe, it, expect } from 'vitest'
import { KeyRenderer } from '../../src/main/streamdeck/key-renderer'
import path from 'node:path'

const svgRoot = path.resolve(__dirname, '../../src/main/streamdeck/assets/cogsworth')

describe('KeyRenderer', () => {
  it('renders a 72x72 PNG buffer for a known SVG', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const png = await r.render({ faceSvg: 'cogsworth-happy.svg', tint: 'none' })
    expect(png).toBeInstanceOf(Buffer)
    // PNG file signature = 0x89 0x50 0x4E 0x47
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
  })

  it('caches identical renders (returns same buffer reference)', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const a = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    const b = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    expect(a).toBe(b)
  })

  it('invalidates cache when tint changes', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const a = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    const b = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'red' })
    expect(a).not.toBe(b)
  })

  it('renders an action key with text label', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const png = await r.renderText({ label: 'VOICE', tint: 'none' })
    expect(png).toBeInstanceOf(Buffer)
    expect(png.byteLength).toBeGreaterThan(0)
  })
})
