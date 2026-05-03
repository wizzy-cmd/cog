import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/main/streamdeck/layout'
import type { AgentState } from '../../src/shared/types'

const agent = (over: Partial<AgentState>): AgentState => ({
  id: over.id ?? `id-${over.name}`,
  name: 'a',
  cli: 'claude',
  cwd: '/tmp',
  role: 'worker',
  ceoNotes: '',
  shell: 'powershell' as const,
  admin: false,
  autoMode: false,
  status: 'idle',
  createdAt: new Date().toISOString(),
  ...over,
} as AgentState)

describe('computeLayout', () => {
  it('produces exactly 15 key descriptors', () => {
    const layout = computeLayout({ agents: [], presets: [], lastActivity: {}, unread: {} })
    expect(layout).toHaveLength(15)
  })

  it('pins orchestrator to slot 0', () => {
    const layout = computeLayout({
      agents: [agent({ name: 'orch', role: 'orchestrator' }), agent({ name: 'w1' })],
      presets: [],
      lastActivity: {},
      unread: {},
    })
    expect(layout[0].kind).toBe('agent')
    expect(layout[0].agent?.role).toBe('orchestrator')
  })

  it('shows orchestrator-missing when no orchestrator running', () => {
    const layout = computeLayout({ agents: [], presets: [], lastActivity: {}, unread: {} })
    expect(layout[0].kind).toBe('empty')
    expect(layout[0].empty).toBe('orchestrator-missing')
  })

  it('fills worker slots 1-4 with non-orchestrators sorted by recency', () => {
    const layout = computeLayout({
      agents: [
        agent({ name: 'orch', role: 'orchestrator' }),
        agent({ name: 'older' }),
        agent({ name: 'newer' }),
      ],
      presets: [],
      lastActivity: { older: 100, newer: 999 },
      unread: {},
    })
    expect(layout[1].agent?.name).toBe('newer')
    expect(layout[2].agent?.name).toBe('older')
    expect(layout[3].kind).toBe('empty')
    expect(layout[4].kind).toBe('empty')
  })

  it('caps worker row at 4 even with many agents', () => {
    const agents = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => agent({ name: n }))
    agents.unshift(agent({ name: 'orch', role: 'orchestrator' }))
    const layout = computeLayout({
      agents,
      presets: [],
      lastActivity: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      unread: {},
    })
    expect(layout[1].agent?.name).toBe('f')
    expect(layout[2].agent?.name).toBe('e')
    expect(layout[3].agent?.name).toBe('d')
    expect(layout[4].agent?.name).toBe('c')
  })

  it('puts the 5 action keys in slots 5-9', () => {
    const layout = computeLayout({ agents: [], presets: [], lastActivity: {}, unread: {} })
    expect(layout.slice(5, 10).map(k => k.action)).toEqual(['voice', 'inbox', 'trollbox', 'stale', 'panic'])
  })

  it('puts presets in slots 10-14, dim if fewer than 5', () => {
    const layout = computeLayout({
      agents: [],
      presets: [{ name: 'team-a', agentCount: 3 }, { name: 'team-b', agentCount: 5 }],
      lastActivity: {},
      unread: {},
    })
    expect(layout[10].kind).toBe('preset')
    expect(layout[10].preset?.name).toBe('team-a')
    expect(layout[11].kind).toBe('preset')
    expect(layout[12].kind).toBe('empty')
    expect(layout[12].empty).toBe('no-preset')
    expect(layout[13].kind).toBe('empty')
    expect(layout[14].kind).toBe('empty')
  })

  it('caps presets at 5', () => {
    const presets = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
      .map(name => ({ name, agentCount: 1 }))
    const layout = computeLayout({ agents: [], presets, lastActivity: {}, unread: {} })
    expect(layout.slice(10, 15).map(k => k.preset?.name)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})
