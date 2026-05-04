import path from 'node:path'
import type { AgentRegistry } from '../hub/agent-registry'
import { computeLayout } from './layout'
import { KeyRenderer } from './key-renderer'
import { moodForStatus, MOODS } from './mood'
import type { KeyDescriptor } from './types'
import type { VoiceState } from './voice-coordinator'

export interface StreamDeckHandle {
  NUM_KEYS: number
  KEY_COLUMNS: number
  setKeyImage(index: number, png: Buffer): Promise<void>
  clearAllKeys(): Promise<void>
  close(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
}

export interface BridgeActions {
  onAgentTap(agentName: string): void
  onAgentHold(agentName: string): void
  onActionTap(action: 'voice' | 'inbox' | 'trollbox' | 'stale' | 'panic'): void
  onActionHold(action: 'voice' | 'inbox' | 'trollbox' | 'stale' | 'panic'): void
  onPresetTap(presetName: string): void
}

export interface BridgeOpts {
  deck: StreamDeckHandle
  registry: AgentRegistry
  listPresets: () => Promise<{ name: string; agentCount: number }[]>
  getUnread: () => { inbox: number; trollbox: number; stale: number }
  svgRoot: string
  actions: BridgeActions
}

export class StreamDeckBridge {
  private opts: BridgeOpts
  private renderer: KeyRenderer
  private lastActivity: Record<string, number> = {}
  private started = false
  private lastRendered: Map<number, string> = new Map()  // index → JSON descriptor
  private debounceTimer: NodeJS.Timeout | null = null
  private pressedAt: Map<number, number> = new Map()
  private holdMs = 1500
  private holdMsPanic = 2000
  private voiceState: VoiceState = 'idle'

  /** Called by the VoiceCoordinator on state transitions; tints the 🎙️ key. */
  setVoiceState(state: VoiceState): void {
    if (this.voiceState === state) return
    this.voiceState = state
    this.scheduleRerender()
  }

  private handleKeyDown = (index: unknown) => {
    console.log(`[streamdeck] bridge handleKeyDown: index=${index} (type=${typeof index})`)
    if (typeof index !== 'number') return
    this.pressedAt.set(index, Date.now())
  }

  private handleKeyUp = (index: unknown) => {
    console.log(`[streamdeck] bridge handleKeyUp: index=${index} pressed=${this.pressedAt.has(index as number)}`)
    if (typeof index !== 'number') return
    const downAt = this.pressedAt.get(index)
    this.pressedAt.delete(index)
    if (downAt === undefined) return
    const heldFor = Date.now() - downAt
    const desc = this.lastDescriptorFor(index)
    console.log(`[streamdeck] bridge handleKeyUp: heldFor=${heldFor}ms desc=${JSON.stringify(desc)}`)
    if (!desc) return

    const threshold = (desc.kind === 'action' && desc.action === 'panic') ? this.holdMsPanic : this.holdMs
    const isHold = heldFor >= threshold

    if (desc.kind === 'agent' && desc.agent) {
      isHold ? this.opts.actions.onAgentHold(desc.agent.name)
             : this.opts.actions.onAgentTap(desc.agent.name)
    } else if (desc.kind === 'action' && desc.action) {
      isHold ? this.opts.actions.onActionHold(desc.action)
             : this.opts.actions.onActionTap(desc.action)
    } else if (desc.kind === 'preset' && desc.preset) {
      this.opts.actions.onPresetTap(desc.preset.name)
    }
  }

  private lastDescriptorFor(index: number): KeyDescriptor | null {
    const sig = this.lastRendered.get(index)
    if (!sig) return null
    try {
      const o = JSON.parse(sig) as { k: string; n?: string; s?: string; a?: string; p?: string; e?: string }
      return {
        index,
        kind: o.k as KeyDescriptor['kind'],
        agent: o.n ? this.opts.registry.list().find(a => a.name === o.n) : undefined,
        action: o.a as KeyDescriptor['action'] | undefined,
        preset: o.p ? { name: o.p, agentCount: 0 } : undefined,
        empty: o.e as KeyDescriptor['empty'] | undefined,
      }
    } catch { return null }
  }

  private onStatus = (e: { name: string; status: string }) => {
    const a = this.opts.registry.get(e.name)
    if (a && (a.role || '').trim().toLowerCase() !== 'orchestrator') {
      this.lastActivity[e.name] = Date.now()
    }
    this.scheduleRerender()
  }
  private onChange = () => this.scheduleRerender()

  private scheduleRerender(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => { void this.renderAll(false) }, 150)
  }

  constructor(opts: BridgeOpts) {
    this.opts = opts
    this.renderer = new KeyRenderer({ svgRoot: opts.svgRoot, size: 72 })
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.opts.registry.on('register', this.onChange)
    this.opts.registry.on('status', this.onStatus)
    this.opts.registry.on('remove', this.onChange)
    this.opts.deck.on('down', this.handleKeyDown as (...args: unknown[]) => void)
    this.opts.deck.on('up', this.handleKeyUp as (...args: unknown[]) => void)
    await this.renderAll(true)
  }

  async dispose(): Promise<void> {
    this.started = false
    this.opts.registry.off('register', this.onChange)
    this.opts.registry.off('status', this.onStatus)
    this.opts.registry.off('remove', this.onChange)
    this.opts.deck.off('down', this.handleKeyDown as (...args: unknown[]) => void)
    this.opts.deck.off('up', this.handleKeyUp as (...args: unknown[]) => void)
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    try { await this.opts.deck.clearAllKeys() } catch { /* device gone */ }
    try { await this.opts.deck.close() } catch { /* idem */ }
  }

  private async renderAll(force: boolean): Promise<void> {
    const layout = computeLayout({
      agents: this.opts.registry.list(),
      presets: await this.opts.listPresets(),
      lastActivity: this.lastActivity,
      unread: this.opts.getUnread(),
    })
    await Promise.all(layout.map(async (k) => {
      // Voice state is folded into the voice key's signature so a state change
      // (idle ↔ recording ↔ transcribing) triggers a re-render with a fresh tint.
      const vs = k.action === 'voice' ? this.voiceState : undefined
      const sig = JSON.stringify({ k: k.kind, n: k.agent?.name, s: k.agent?.status, a: k.action, p: k.preset?.name, e: k.empty, vs })
      if (!force && this.lastRendered.get(k.index) === sig) return
      this.lastRendered.set(k.index, sig)
      await this.renderKey(k)
    }))
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
      // Tint the 🎙️ key red while recording, orange while transcribing, default otherwise.
      const tint =
        key.action === 'voice' && this.voiceState === 'recording' ? 'red'
        : key.action === 'voice' && this.voiceState === 'transcribing' ? 'orange'
        : 'none'
      return this.renderer.renderText({ label: labelMap[key.action!], tint, badge })
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
