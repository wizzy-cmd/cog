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
      actions: {
        onAgentTap: vi.fn(),
        onAgentHold: vi.fn(),
        onActionTap: vi.fn(),
        onActionHold: vi.fn(),
        onPresetTap: vi.fn(),
      },
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
      actions: {
        onAgentTap: vi.fn(),
        onAgentHold: vi.fn(),
        onActionTap: vi.fn(),
        onActionHold: vi.fn(),
        onPresetTap: vi.fn(),
      },
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
      actions: {
        onAgentTap: vi.fn(),
        onAgentHold: vi.fn(),
        onActionTap: vi.fn(),
        onActionHold: vi.fn(),
        onPresetTap: vi.fn(),
      },
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
      actions: {
        onAgentTap: vi.fn(),
        onAgentHold: vi.fn(),
        onActionTap: vi.fn(),
        onActionHold: vi.fn(),
        onPresetTap: vi.fn(),
      },
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

  it('dispatches agent tap on short press, hold on long press', async () => {
    const onAgentTap = vi.fn()
    const onAgentHold = vi.fn()

    registry.register({
      id: 'x', name: 'wrk-1', cli: 'claude', cwd: '/tmp', role: 'worker',
      ceoNotes: '', shell: 'powershell' as const, admin: false, autoMode: false,
    })

    const bridge = new StreamDeckBridge({
      deck,
      registry,
      listPresets: async () => [],
      getUnread: () => ({ inbox: 0, trollbox: 0, stale: 0 }),
      svgRoot: 'src/main/streamdeck/assets/cogsworth',
      actions: {
        onAgentTap, onAgentHold,
        onActionTap: vi.fn(), onActionHold: vi.fn(), onPresetTap: vi.fn(),
      },
    })
    await bridge.start()

    const onCalls = deck.on.mock.calls
    const downCb = onCalls.find(c => c[0] === 'down')?.[1]
    const upCb   = onCalls.find(c => c[0] === 'up')?.[1]

    // With no orchestrator, slot 0 is empty and the worker fills slot 1.
    downCb!(1)
    upCb!(1)
    expect(onAgentTap).toHaveBeenCalledWith('wrk-1')
    expect(onAgentHold).not.toHaveBeenCalled()

    onAgentTap.mockClear()
    downCb!(1)
    await new Promise(r => setTimeout(r, 1600))
    upCb!(1)
    expect(onAgentHold).toHaveBeenCalledWith('wrk-1')
    expect(onAgentTap).not.toHaveBeenCalled()
  })
})
