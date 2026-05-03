import { describe, it, expect, beforeEach } from 'vitest'
import { readStreamDeckSettings, writeStreamDeckSettings } from '../../src/main/streamdeck/settings'
import type { StreamDeckSettings } from '../../src/main/streamdeck/types'

describe('Stream Deck settings', () => {
  let store: Record<string, unknown>

  const fakeIO = {
    load: () => store,
    save: (next: Record<string, unknown>) => { store = next }
  }

  beforeEach(() => { store = {} })

  it('returns defaults when nothing persisted', () => {
    const s = readStreamDeckSettings(fakeIO)
    expect(s.enabled).toBe(true)
    expect(s.whisperBackend).toBe('cloud')
    expect(s.openaiApiKey).toBeUndefined()
  })

  it('round-trips a partial update', () => {
    writeStreamDeckSettings(fakeIO, { whisperBackend: 'local' })
    expect(readStreamDeckSettings(fakeIO).whisperBackend).toBe('local')
    // Other defaults preserved
    expect(readStreamDeckSettings(fakeIO).enabled).toBe(true)
  })

  it('persists openai api key', () => {
    writeStreamDeckSettings(fakeIO, { openaiApiKey: 'sk-test-123' })
    expect(readStreamDeckSettings(fakeIO).openaiApiKey).toBe('sk-test-123')
  })

  it('returns a fresh defaults object each call (no mutation leak)', () => {
    const a = readStreamDeckSettings(fakeIO)
    a.enabled = false
    const b = readStreamDeckSettings(fakeIO)
    expect(b.enabled).toBe(true)
  })
})
