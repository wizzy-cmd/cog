import path from 'node:path'
import type { AgentRegistry } from '../hub/agent-registry'
import { computeLayout } from './layout'
import { KeyRenderer } from './key-renderer'
import { moodForStatus, MOODS } from './mood'
import type { KeyDescriptor } from './types'

export interface StreamDeckHandle {
  NUM_KEYS: number
  KEY_COLUMNS: number
  setKeyImage(index: number, png: Buffer): Promise<void>
  clearAllKeys(): Promise<void>
  close(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
}

export interface BridgeOpts {
  deck: StreamDeckHandle
  registry: AgentRegistry
  listPresets: () => Promise<{ name: string; agentCount: number }[]>
  getUnread: () => { inbox: number; trollbox: number; stale: number }
  svgRoot: string
}

export class StreamDeckBridge {
  private opts: BridgeOpts
  private renderer: KeyRenderer
  private lastActivity: Record<string, number> = {}
  private started = false

  constructor(opts: BridgeOpts) {
    this.opts = opts
    this.renderer = new KeyRenderer({ svgRoot: opts.svgRoot, size: 72 })
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.renderAll()
  }

  async dispose(): Promise<void> {
    this.started = false
    try { await this.opts.deck.clearAllKeys() } catch { /* device may be gone */ }
    try { await this.opts.deck.close() } catch { /* idem */ }
  }

  private async renderAll(): Promise<void> {
    const layout = computeLayout({
      agents: this.opts.registry.list(),
      presets: await this.opts.listPresets(),
      lastActivity: this.lastActivity,
      unread: this.opts.getUnread(),
    })
    await Promise.all(layout.map(k => this.renderKey(k)))
  }

  private async renderKey(key: KeyDescriptor): Promise<void> {
    const png = await this.imageFor(key)
    await this.opts.deck.setKeyImage(key.index, png)
  }

  private async imageFor(key: KeyDescriptor): Promise<Buffer> {
    const unread = this.opts.getUnread()
    if (key.kind === 'agent' && key.agent) {
      const face = moodForStatus(key.agent.status)
      const tint = key.agent.status === 'disconnected' ? 'grey' : 'none'
      return this.renderer.render({ faceSvg: face, tint })
    }
    if (key.kind === 'empty' && key.empty === 'orchestrator-missing') {
      return this.renderer.render({ faceSvg: MOODS.sleeping, tint: 'grey' })
    }
    if (key.kind === 'empty') {
      return this.renderer.renderText({ label: '', tint: 'grey' })
    }
    if (key.kind === 'action') {
      const labelMap: Record<NonNullable<KeyDescriptor['action']>, string> = {
        voice: 'VOICE',
        inbox: 'INBOX',
        trollbox: 'TROLL',
        stale: 'STALE',
        panic: 'PANIC',
      }
      const badge =
        key.action === 'inbox' && unread.inbox > 0 ? String(unread.inbox)
        : key.action === 'trollbox' && unread.trollbox > 0 ? String(unread.trollbox)
        : key.action === 'stale' && unread.stale > 0 ? String(unread.stale)
        : undefined
      return this.renderer.renderText({ label: labelMap[key.action!], tint: 'none', badge })
    }
    if (key.kind === 'preset' && key.preset) {
      return this.renderer.renderText({
        label: `TEAM ${key.index - 9}`,
        tint: 'none',
        badge: String(key.preset.agentCount),
      })
    }
    // Unreachable, but TS wants a return
    return this.renderer.renderText({ label: '', tint: 'grey' })
  }
}
