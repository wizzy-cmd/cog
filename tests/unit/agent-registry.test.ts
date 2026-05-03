import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '../../src/main/hub/agent-registry'
import type { AgentConfig, AgentState, AgentStatus } from '../../src/shared/types'

const makeConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'test-1',
  name: 'worker-1',
  cli: 'claude',
  cwd: '/tmp',
  role: 'Tester',
  ceoNotes: 'Test agent',
  shell: 'powershell' as const,
  admin: false,
  autoMode: false,
  ...overrides
})

describe('AgentRegistry', () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = new AgentRegistry()
  })

  it('registers an agent and returns its state', () => {
    const config = makeConfig()
    const state = registry.register(config)
    expect(state.name).toBe('worker-1')
    expect(state.status).toBe('idle')
  })

  it('upserts on duplicate name instead of throwing', () => {
    registry.register(makeConfig({ role: 'original' }))
    const updated = registry.register(makeConfig({ id: 'test-2', role: 'updated' }))
    expect(updated.role).toBe('updated')
    expect(updated.status).toBe('idle')
    // Should still be 1 agent, not 2
    expect(registry.list()).toHaveLength(1)
  })

  it('lists all agents', () => {
    registry.register(makeConfig({ id: '1', name: 'a' }))
    registry.register(makeConfig({ id: '2', name: 'b' }))
    expect(registry.list()).toHaveLength(2)
  })

  it('gets agent by name', () => {
    registry.register(makeConfig())
    expect(registry.get('worker-1')).toBeDefined()
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('updates agent status', () => {
    registry.register(makeConfig())
    registry.updateStatus('worker-1', 'working')
    expect(registry.get('worker-1')!.status).toBe('working')
  })

  it('removes an agent', () => {
    registry.register(makeConfig())
    registry.remove('worker-1')
    expect(registry.get('worker-1')).toBeUndefined()
    expect(registry.list()).toHaveLength(0)
  })

  it('emits register event when an agent is added', () => {
    let captured: AgentState | null = null
    registry.on('register', (a) => { captured = a })
    registry.register(makeConfig({ name: 'event-1' }))
    expect(captured?.name).toBe('event-1')
  })

  it('emits status event when status changes', () => {
    registry.register(makeConfig({ name: 'event-2' }))
    let captured: { name: string; status: AgentStatus } | null = null
    registry.on('status', (e) => { captured = e })
    registry.updateStatus('event-2', 'working')
    expect(captured).toEqual({ name: 'event-2', status: 'working' })
  })

  it('emits remove event when an agent is removed', () => {
    registry.register(makeConfig({ name: 'event-3' }))
    let captured: string | null = null
    registry.on('remove', (name: string) => { captured = name })
    registry.remove('event-3')
    expect(captured).toBe('event-3')
  })
})
