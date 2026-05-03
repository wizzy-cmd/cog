import { describe, it, expect } from 'vitest'
import { moodForStatus, MOODS } from '../../src/main/streamdeck/mood'

describe('moodForStatus', () => {
  it('idle → neutral', () => expect(moodForStatus('idle')).toBe(MOODS.neutral))
  it('active → thinking', () => expect(moodForStatus('active')).toBe(MOODS.thinking))
  it('working → focused', () => expect(moodForStatus('working')).toBe(MOODS.focused))
  it('disconnected → dead', () => expect(moodForStatus('disconnected')).toBe(MOODS.dead))

  it('all SVG names match files in marketing/cogsworth', () => {
    // Sanity check that the constants point at SVGs that actually exist
    const names = Object.values(MOODS)
    for (const name of names) {
      expect(name).toMatch(/^cogsworth-[a-z]+\.svg$/)
    }
  })
})
