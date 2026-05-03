import type { AgentState } from '../../shared/types'
import type { KeyDescriptor } from './types'

export interface LayoutInput {
  agents: AgentState[]
  presets: { name: string; agentCount: number }[]
  lastActivity: Record<string, number>     // agent name → epoch ms
  unread: Record<string, number>           // 'inbox' | 'trollbox' | 'stale' → count
}

const ACTION_ORDER = ['voice', 'inbox', 'trollbox', 'stale', 'panic'] as const

export function computeLayout(input: LayoutInput): KeyDescriptor[] {
  const keys: KeyDescriptor[] = []

  // Slot 0 — orchestrator
  const orch = input.agents.find(a => (a.role || '').trim().toLowerCase() === 'orchestrator')
  keys.push(orch
    ? { index: 0, kind: 'agent', agent: orch }
    : { index: 0, kind: 'empty', empty: 'orchestrator-missing' })

  // Slots 1-4 — workers (most-recently-active first, max 4)
  const workers = input.agents
    .filter(a => (a.role || '').trim().toLowerCase() !== 'orchestrator')
    .sort((a, b) => (input.lastActivity[b.name] ?? 0) - (input.lastActivity[a.name] ?? 0))
    .slice(0, 4)

  for (let i = 0; i < 4; i++) {
    if (workers[i]) {
      keys.push({ index: i + 1, kind: 'agent', agent: workers[i] })
    } else {
      keys.push({ index: i + 1, kind: 'empty', empty: 'no-worker' })
    }
  }

  // Slots 5-9 — actions
  for (let i = 0; i < 5; i++) {
    keys.push({ index: i + 5, kind: 'action', action: ACTION_ORDER[i] })
  }

  // Slots 10-14 — presets (max 5, oldest first)
  for (let i = 0; i < 5; i++) {
    if (input.presets[i]) {
      keys.push({ index: i + 10, kind: 'preset', preset: input.presets[i] })
    } else {
      keys.push({ index: i + 10, kind: 'empty', empty: 'no-preset' })
    }
  }

  return keys
}
