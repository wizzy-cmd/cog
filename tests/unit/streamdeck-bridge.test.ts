import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StreamDeckBridge, type StreamDeckHandle } from '../../src/main/streamdeck/bridge'
import { AgentRegistry } from '../../src/main/hub/agent-registry'

class FakeDeck implements StreamDeckHandle {
  setKeyImage = vi.fn(async (_idx: number, _png: Buffer) => {})
  clearAllKeys = vi.fn(async () => {})
  on = vi.fn()
  off = vi.fn()
  close = vi.fn(async () => {})
  KEY_COLUMNS = 5
  NUM_KEYS = 15
}

describe('StreamDeckBridge', () => {
  let registry: AgentRegistry
  let deck: FakeDeck

  beforeEach(() => {
    registry = new AgentRegistry()
    deck = new FakeDeck()
  })

  it('renders 15 keys on init', async () => {
    const bridge = new StreamDeckBridge({
      deck,
      registry,
      listPresets: async () => [],
      getUnread: () => ({ inbox: 0, trollbox: 0, stale: 0 }),
      svgRoot: 'src/main/streamdeck/assets/cogsworth',
    })
    await bridge.start()
    expect(deck.setKeyImage).toHaveBeenCalledTimes(15)
  })

  it('does not crash if registry has no orchestrator', async () => {
    const bridge = new StreamDeckBridge({
      deck,
      registry,
      listPresets: async () => [],
      getUnread: () => ({ inbox: 0, trollbox: 0, stale: 0 }),
      svgRoot: 'src/main/streamdeck/assets/cogsworth',
    })
    await bridge.start()
    // Slot 0 should still be rendered (orchestrator-missing variant)
    const slot0Calls = deck.setKeyImage.mock.calls.filter(c => c[0] === 0)
    expect(slot0Calls.length).toBeGreaterThan(0)
  })
})
