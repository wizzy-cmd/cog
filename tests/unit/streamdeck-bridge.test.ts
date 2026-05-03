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

  it('re-renders when an agent registers', async () => {
    const bridge = new StreamDeckBridge({
      deck,
      registry,
      listPresets: async () => [],
      getUnread: () => ({ inbox: 0, trollbox: 0, stale: 0 }),
      svgRoot: 'src/main/streamdeck/assets/cogsworth',
    })
    await bridge.start()
    deck.setKeyImage.mockClear()
    registry.register({
      id: 'x', name: 'orch', cli: 'claude', cwd: '/tmp', role: 'orchestrator',
      ceoNotes: '', shell: 'powershell' as const, admin: false, autoMode: false,
    })
    await new Promise(r => setTimeout(r, 200))
    // At minimum, slot 0 (orchestrator) should have re-rendered
    expect(deck.setKeyImage.mock.calls.some(c => c[0] === 0)).toBe(true)
  })

  it('re-renders only changed keys', async () => {
    registry.register({
      id: 'x', name: 'orch', cli: 'claude', cwd: '/tmp', role: 'orchestrator',
      ceoNotes: '', shell: 'powershell' as const, admin: false, autoMode: false,
    })
    const bridge = new StreamDeckBridge({
      deck,
      registry,
      listPresets: async () => [],
      getUnread: () => ({ inbox: 0, trollbox: 0, stale: 0 }),
      svgRoot: 'src/main/streamdeck/assets/cogsworth',
    })
    await bridge.start()
    deck.setKeyImage.mockClear()
    registry.updateStatus('orch', 'working')
    await new Promise(r => setTimeout(r, 200))
    const indices = new Set(deck.setKeyImage.mock.calls.map(c => c[0]))
    expect(indices.has(0)).toBe(true)
    // Did NOT re-render the action / preset rows (slots 5-14)
    expect([...indices].every(i => i < 5)).toBe(true)
  })
})
