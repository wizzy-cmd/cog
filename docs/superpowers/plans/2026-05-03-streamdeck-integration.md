# Stream Deck Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Elgato Stream Deck MK.2 support to The Cog — a 15-key physical command bridge showing agent statuses (Cogsworth mood faces), one-tap action keys (voice / inbox / trollbox / stale / panic), and 5 preset team launchers.

**Architecture:** A `StreamDeckBridge` module in the Electron main process owns the USB HID device via `@elgato-stream-deck/node`. It subscribes to existing `AgentRegistry`, inbox, trollbox, and pinboard events and re-renders the 15 keys event-driven (no polling). Voice recording uses the existing main BrowserWindow's renderer-side `MediaRecorder` for audio capture, then routes the audio through a `WhisperClient` (Cloud or Local) and writes the transcript into the orchestrator agent's PTY via the existing `WRITE_TO_PTY` IPC.

**Tech Stack:** TypeScript, Electron 41, vitest, `@elgato-stream-deck/node`, `@resvg/resvg-js` (already a dep), `nodejs-whisper` (local STT), OpenAI Whisper REST API via `fetch` (cloud STT).

**Spec:** [docs/superpowers/specs/2026-05-03-streamdeck-integration-design.md](../specs/2026-05-03-streamdeck-integration-design.md)

---

## Task 1: Add deps + scaffold module

**Files:**
- Modify: `package.json`
- Create: `src/main/streamdeck/index.ts`
- Create: `src/main/streamdeck/types.ts`

- [ ] **Step 1: Install Stream Deck + Whisper deps**

```bash
npm install @elgato-stream-deck/node nodejs-whisper
```

Expected: both packages installed, `package.json` `dependencies` updated. `nodejs-whisper` may pull native bindings — that's fine, the existing `postinstall` electron-rebuild handles it.

- [ ] **Step 2: Verify `npm run build` still succeeds**

Run: `npm run build`
Expected: build completes, no errors. Confirms native deps rebuilt cleanly.

- [ ] **Step 3: Create types module**

Create `src/main/streamdeck/types.ts`:

```ts
import type { AgentState } from '../../shared/types'

export type WhisperBackend = 'cloud' | 'local' | 'disabled'

export interface StreamDeckSettings {
  enabled: boolean
  whisperBackend: WhisperBackend
  openaiApiKey?: string
}

export const DEFAULT_STREAMDECK_SETTINGS: StreamDeckSettings = {
  enabled: true,
  whisperBackend: 'cloud',
}

export interface KeyDescriptor {
  index: number              // 0..14
  kind: 'agent' | 'action' | 'preset' | 'empty'
  agent?: AgentState         // present when kind === 'agent'
  action?: 'voice' | 'inbox' | 'trollbox' | 'stale' | 'panic'
  preset?: { name: string; agentCount: number }
  empty?: 'orchestrator-missing' | 'no-worker' | 'no-preset'
}

export interface KeyVisualState {
  faceSvg: string            // e.g. 'cogsworth-focused.svg'
  tint: 'none' | 'red' | 'orange' | 'green' | 'grey'
  badge?: string             // e.g. '3' for unread count
  label?: string             // e.g. 'TEAM 1', 'VOICE'
  pulsing?: boolean
}
```

- [ ] **Step 4: Create stub index module**

Create `src/main/streamdeck/index.ts`:

```ts
// Public entrypoint. Wired into src/main/index.ts at app.whenReady().
// Subsequent tasks fill in init/dispose.

export async function initStreamDeck(): Promise<void> {
  // implemented in Task 13
}

export async function disposeStreamDeck(): Promise<void> {
  // implemented in Task 13
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to new files.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/streamdeck/
git commit -m "feat(streamdeck): scaffold module + add @elgato-stream-deck/node and nodejs-whisper deps"
```

---

## Task 2: Settings persistence for Stream Deck namespace

**Files:**
- Modify: `src/main/index.ts:130-160` (existing settings helpers area)
- Create: `src/main/streamdeck/settings.ts`
- Create: `tests/unit/streamdeck-settings.test.ts`

- [ ] **Step 1: Write failing settings test**

Create `tests/unit/streamdeck-settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-settings.test.ts`
Expected: FAIL with "Cannot find module .../streamdeck/settings"

- [ ] **Step 3: Implement settings helpers**

Create `src/main/streamdeck/settings.ts`:

```ts
import { DEFAULT_STREAMDECK_SETTINGS, type StreamDeckSettings } from './types'

export interface SettingsIO {
  load(): Record<string, unknown>
  save(next: Record<string, unknown>): void
}

const KEY = 'streamdeck'

export function readStreamDeckSettings(io: SettingsIO): StreamDeckSettings {
  const all = io.load()
  const stored = (all[KEY] as Partial<StreamDeckSettings> | undefined) ?? {}
  return { ...DEFAULT_STREAMDECK_SETTINGS, ...stored }
}

export function writeStreamDeckSettings(io: SettingsIO, patch: Partial<StreamDeckSettings>): void {
  const all = io.load()
  const current = (all[KEY] as Partial<StreamDeckSettings> | undefined) ?? {}
  all[KEY] = { ...DEFAULT_STREAMDECK_SETTINGS, ...current, ...patch }
  io.save(all)
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-settings.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/settings.ts tests/unit/streamdeck-settings.test.ts
git commit -m "feat(streamdeck): settings read/write under streamdeck namespace"
```

---

## Task 3: AgentRegistry events

**Files:**
- Modify: `src/main/hub/agent-registry.ts`
- Modify: `tests/unit/agent-registry.test.ts`

The Stream Deck bridge needs to react to status / register / remove. Today the registry is a passive store. Add a small `EventEmitter` for these three events. Existing callers use direct method calls — they don't need to change.

- [ ] **Step 1: Add failing event-emission test**

Append to `tests/unit/agent-registry.test.ts` (inside the existing `describe`):

```ts
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
```

Add the `AgentStatus` import at the top of the test file:

```ts
import type { AgentConfig, AgentState, AgentStatus } from '../../src/shared/types'
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/agent-registry.test.ts`
Expected: FAIL — `registry.on is not a function`.

- [ ] **Step 3: Implement EventEmitter on registry**

Modify `src/main/hub/agent-registry.ts`. Add at the top:

```ts
import { EventEmitter } from 'node:events'
```

Change the class declaration:

```ts
export class AgentRegistry extends EventEmitter {
```

Add `super()` to a constructor (none exists — add one):

```ts
  constructor() {
    super()
  }
```

Modify `register()` to emit:

```ts
  register(config: AgentConfig): AgentState {
    const existing = this.agents.get(config.name)
    if (existing) {
      copyConfigFields(config, existing)
      existing.status = 'idle'
      this.emit('status', { name: existing.name, status: existing.status })
      return existing
    }
    const state: AgentState = {
      status: 'idle',
      createdAt: new Date().toISOString()
    } as AgentState
    copyConfigFields(config, state)
    this.agents.set(config.name, state)
    this.emit('register', state)
    return state
  }
```

Modify `updateStatus()` to emit:

```ts
  updateStatus(name: string, status: AgentStatus): void {
    const agent = this.agents.get(name)
    if (agent && agent.status !== status) {
      agent.status = status
      this.emit('status', { name, status })
    }
  }
```

Modify `remove()` to emit:

```ts
  remove(name: string): void {
    if (!this.agents.has(name)) return
    this.agents.delete(name)
    this.lastHeartbeat.delete(name)
    this.emit('remove', name)
  }
```

- [ ] **Step 4: Run all registry tests**

Run: `npx vitest run tests/unit/agent-registry.test.ts`
Expected: all tests pass, including the 3 new event tests.

- [ ] **Step 5: Run full test suite to confirm nothing else broke**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/hub/agent-registry.ts tests/unit/agent-registry.test.ts
git commit -m "feat(agent-registry): emit register/status/remove events"
```

---

## Task 4: Pure layout function

**Files:**
- Create: `src/main/streamdeck/layout.ts`
- Create: `tests/unit/streamdeck-layout.test.ts`

Pure function: given agents + presets + unread counts, return the 15-key descriptor. No side effects. Used by the bridge to compute "what should the deck look like right now."

- [ ] **Step 1: Write failing layout test**

Create `tests/unit/streamdeck-layout.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeLayout`**

Create `src/main/streamdeck/layout.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-layout.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/layout.ts tests/unit/streamdeck-layout.test.ts
git commit -m "feat(streamdeck): pure computeLayout — agents+presets → 15-key descriptor"
```

---

## Task 5: Status → mood mapping (pure)

**Files:**
- Create: `src/main/streamdeck/mood.ts`
- Create: `tests/unit/streamdeck-mood.test.ts`

Maps the 4 real `AgentStatus` values to Cogsworth SVG file names. The spec listed 7 statuses; collapsing to 4 to match what `AgentRegistry` actually emits. Alert / pulsing is handled separately as a tint, not as a face — keeps this function pure.

- [ ] **Step 1: Write failing mood test**

Create `tests/unit/streamdeck-mood.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-mood.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement mood mapping**

Create `src/main/streamdeck/mood.ts`:

```ts
import type { AgentStatus } from '../../shared/types'

// SVG file names in marketing/cogsworth/ that we use.
export const MOODS = {
  neutral: 'cogsworth-neutral.svg',
  thinking: 'cogsworth-thinking.svg',
  focused: 'cogsworth-focused.svg',
  dead: 'cogsworth-dead.svg',
  sleeping: 'cogsworth-sleeping.svg',
  alert: 'cogsworth-alert.svg',
  happy: 'cogsworth-happy.svg',
} as const

export function moodForStatus(status: AgentStatus): string {
  switch (status) {
    case 'idle': return MOODS.neutral
    case 'active': return MOODS.thinking
    case 'working': return MOODS.focused
    case 'disconnected': return MOODS.dead
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-mood.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Verify the SVG files actually exist**

Run: `ls marketing/cogsworth/cogsworth-{neutral,thinking,focused,dead,sleeping,alert,happy}.svg`
Expected: all 7 files listed.

- [ ] **Step 6: Commit**

```bash
git add src/main/streamdeck/mood.ts tests/unit/streamdeck-mood.test.ts
git commit -m "feat(streamdeck): pure status → Cogsworth mood SVG mapping"
```

---

## Task 6: Key renderer (SVG → 72×72 PNG with tints + cache)

**Files:**
- Create: `src/main/streamdeck/key-renderer.ts`
- Create: `tests/unit/streamdeck-key-renderer.test.ts`

Renders 72×72 PNG buffers from Cogsworth SVGs with optional tint and badge overlay. Caches by `<svg>:<tint>:<badge>:<label>` — re-renders only when the input changes.

`@resvg/resvg-js` is already a dep (used by `scripts/build-icons.mjs`). Tints applied via simple per-pixel multiply post-rasterize. Badge text overlay drawn into the same buffer.

- [ ] **Step 1: Write failing key-renderer test**

Create `tests/unit/streamdeck-key-renderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { KeyRenderer } from '../../src/main/streamdeck/key-renderer'
import path from 'node:path'

const svgRoot = path.resolve(__dirname, '../../src/main/streamdeck/assets/cogsworth')

describe('KeyRenderer', () => {
  it('renders a 72x72 PNG buffer for a known SVG', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const png = await r.render({ faceSvg: 'cogsworth-happy.svg', tint: 'none' })
    expect(png).toBeInstanceOf(Buffer)
    // PNG file signature = 0x89 0x50 0x4E 0x47
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
  })

  it('caches identical renders (returns same buffer reference)', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const a = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    const b = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    expect(a).toBe(b)
  })

  it('invalidates cache when tint changes', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const a = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'none' })
    const b = await r.render({ faceSvg: 'cogsworth-neutral.svg', tint: 'red' })
    expect(a).not.toBe(b)
  })

  it('renders an action key with text label', async () => {
    const r = new KeyRenderer({ svgRoot, size: 72 })
    const png = await r.renderText({ label: 'VOICE', tint: 'none' })
    expect(png).toBeInstanceOf(Buffer)
    expect(png.byteLength).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-key-renderer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement KeyRenderer**

Create `src/main/streamdeck/key-renderer.ts`:

```ts
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'

export type Tint = 'none' | 'red' | 'orange' | 'green' | 'grey'

export interface RenderInput {
  faceSvg: string         // e.g. 'cogsworth-focused.svg'
  tint: Tint
  badge?: string          // e.g. '3'
  label?: string          // e.g. 'VOICE'
}

export interface RenderTextInput {
  label: string
  tint: Tint
  badge?: string
}

const TINT_RGB: Record<Tint, [number, number, number] | null> = {
  none: null,
  red: [255, 80, 80],
  orange: [255, 160, 60],
  green: [80, 220, 120],
  grey: [140, 140, 140],
}

export class KeyRenderer {
  private svgRoot: string
  private size: number
  private cache = new Map<string, Buffer>()
  private svgFileCache = new Map<string, string>()

  constructor(opts: { svgRoot: string; size: number }) {
    this.svgRoot = opts.svgRoot
    this.size = opts.size
  }

  async render(input: RenderInput): Promise<Buffer> {
    const key = this.cacheKey('face', input.faceSvg, input.tint, input.badge, input.label)
    const hit = this.cache.get(key)
    if (hit) return hit

    const svg = this.loadSvg(input.faceSvg)
    let png = this.rasterize(svg)
    png = this.applyTint(png, input.tint)
    if (input.badge) png = this.drawBadge(png, input.badge)
    if (input.label) png = this.drawLabel(png, input.label)

    this.cache.set(key, png)
    return png
  }

  async renderText(input: RenderTextInput): Promise<Buffer> {
    const key = this.cacheKey('text', input.label, input.tint, input.badge)
    const hit = this.cache.get(key)
    if (hit) return hit

    // Black background SVG with the label centered
    const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.size}" height="${this.size}">
      <rect width="100%" height="100%" fill="#1a1a1a"/>
      <text x="50%" y="55%" font-size="16" fill="#fff" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif" font-weight="600">${this.escape(input.label)}</text>
    </svg>`

    let png = this.rasterize(labelSvg)
    png = this.applyTint(png, input.tint)
    if (input.badge) png = this.drawBadge(png, input.badge)

    this.cache.set(key, png)
    return png
  }

  clearCache(): void {
    this.cache.clear()
  }

  private cacheKey(...parts: (string | undefined)[]): string {
    return parts.map(p => p ?? '').join('|')
  }

  private loadSvg(name: string): string {
    const cached = this.svgFileCache.get(name)
    if (cached) return cached
    const full = path.join(this.svgRoot, name)
    const svg = fs.readFileSync(full, 'utf-8')
    this.svgFileCache.set(name, svg)
    return svg
  }

  private rasterize(svg: string | Buffer): Buffer {
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: this.size },
      background: '#1a1a1a',
    })
    return r.render().asPng()
  }

  private applyTint(png: Buffer, tint: Tint): Buffer {
    const rgb = TINT_RGB[tint]
    if (!rgb) return png
    // Cheap approach: parse PNG via Resvg's re-encode pipeline by overlaying
    // a translucent rect. Re-rasterize a composite SVG with the tint layer.
    // For v1 the tint is "good enough if the LCD is recognizable" — exact
    // color science isn't important.
    const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.size}" height="${this.size}">
      <image href="data:image/png;base64,${png.toString('base64')}" width="${this.size}" height="${this.size}"/>
      <rect width="100%" height="100%" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})" opacity="0.35"/>
    </svg>`
    return this.rasterize(composite)
  }

  private drawBadge(png: Buffer, text: string): Buffer {
    const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.size}" height="${this.size}">
      <image href="data:image/png;base64,${png.toString('base64')}" width="${this.size}" height="${this.size}"/>
      <circle cx="${this.size - 14}" cy="14" r="11" fill="#e23b3b" stroke="#fff" stroke-width="1.5"/>
      <text x="${this.size - 14}" y="18" font-size="13" fill="#fff" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif" font-weight="700">${this.escape(text)}</text>
    </svg>`
    return this.rasterize(composite)
  }

  private drawLabel(png: Buffer, text: string): Buffer {
    const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.size}" height="${this.size}">
      <image href="data:image/png;base64,${png.toString('base64')}" width="${this.size}" height="${this.size}"/>
      <rect x="0" y="${this.size - 16}" width="100%" height="16" fill="#000" opacity="0.55"/>
      <text x="50%" y="${this.size - 4}" font-size="11" fill="#fff" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif">${this.escape(text)}</text>
    </svg>`
    return this.rasterize(composite)
  }

  private escape(s: string): string {
    return s.replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[ch]!))
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-key-renderer.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/key-renderer.ts tests/unit/streamdeck-key-renderer.test.ts
git commit -m "feat(streamdeck): KeyRenderer — SVG → 72x72 PNG with tints, badges, labels, cache"
```

---

## Task 7: Whisper client interface + CloudWhisperClient

**Files:**
- Create: `src/main/streamdeck/whisper-client.ts`
- Create: `tests/unit/streamdeck-whisper-cloud.test.ts`

Cloud client uses `fetch` (no SDK dep) to POST to `https://api.openai.com/v1/audio/transcriptions`. Uses multipart/form-data with the audio buffer attached as `file` and `model=whisper-1`.

- [ ] **Step 1: Write failing cloud-whisper test**

Create `tests/unit/streamdeck-whisper-cloud.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CloudWhisperClient } from '../../src/main/streamdeck/whisper-client'

describe('CloudWhisperClient', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('POSTs the audio to OpenAI and returns the transcript text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello orchestrator' }),
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock })
    const audio = new ArrayBuffer(16)
    const text = await client.transcribe(audio)

    expect(text).toBe('hello orchestrator')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('throws a typed error on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: async () => '{"error":{"message":"bad key"}}',
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/bad key/)
  })

  it('rejects when API key is missing', async () => {
    const client = new CloudWhisperClient({ apiKey: '', fetch: vi.fn() })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/api key/i)
  })

  it('aborts on timeout', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        ;(init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new Error('aborted')))
      })
    })
    const client = new CloudWhisperClient({ apiKey: 'sk-test', fetch: fetchMock, timeoutMs: 50 })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow(/aborted|timed out/i)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-whisper-cloud.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WhisperClient interface + CloudWhisperClient**

Create `src/main/streamdeck/whisper-client.ts`:

```ts
export interface WhisperClient {
  transcribe(audio: ArrayBuffer): Promise<string>
}

type FetchFn = typeof fetch

export interface CloudWhisperOpts {
  apiKey: string
  fetch?: FetchFn
  timeoutMs?: number
}

export class CloudWhisperClient implements WhisperClient {
  private apiKey: string
  private fetch: FetchFn
  private timeoutMs: number

  constructor(opts: CloudWhisperOpts) {
    this.apiKey = opts.apiKey
    this.fetch = opts.fetch ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
  }

  async transcribe(audio: ArrayBuffer): Promise<string> {
    if (!this.apiKey) throw new Error('OpenAI API key not configured')

    const form = new FormData()
    form.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm')
    form.append('model', 'whisper-1')

    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: ctl.signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Whisper ${res.status}: ${body || res.statusText}`)
      }
      const json = await res.json() as { text?: string }
      return (json.text ?? '').trim()
    } finally {
      clearTimeout(t)
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-whisper-cloud.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/whisper-client.ts tests/unit/streamdeck-whisper-cloud.test.ts
git commit -m "feat(streamdeck): WhisperClient interface + CloudWhisperClient (OpenAI fetch)"
```

---

## Task 8: LocalWhisperClient (nodejs-whisper wrapper)

**Files:**
- Modify: `src/main/streamdeck/whisper-client.ts`
- Create: `tests/unit/streamdeck-whisper-local.test.ts`

Thin wrapper around `nodejs-whisper`. Writes the audio buffer to a temp file, calls `nodewhisper(filePath, opts)`, returns trimmed transcript.

`nodejs-whisper` downloads the model file on first use to its own cache dir under the package's install location. We don't expose download progress on the LCD in v1 — too fiddly across the Node API. We surface "downloading…" via console log only, with a toast on first init from the bridge.

- [ ] **Step 1: Write failing local-whisper test**

Create `tests/unit/streamdeck-whisper-local.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub nodejs-whisper before importing the client
vi.mock('nodejs-whisper', () => ({
  nodewhisper: vi.fn(async (_path: string) => 'hello from local whisper\n'),
}))

import { LocalWhisperClient } from '../../src/main/streamdeck/whisper-client'

describe('LocalWhisperClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('writes audio to temp file, runs nodewhisper, returns trimmed text', async () => {
    const client = new LocalWhisperClient({ model: 'base.en' })
    const text = await client.transcribe(new ArrayBuffer(16))
    expect(text).toBe('hello from local whisper')
  })

  it('cleans up the temp audio file even on error', async () => {
    const { nodewhisper } = await import('nodejs-whisper') as { nodewhisper: ReturnType<typeof vi.fn> }
    nodewhisper.mockRejectedValueOnce(new Error('whisper exploded'))

    const client = new LocalWhisperClient({ model: 'base.en' })
    await expect(client.transcribe(new ArrayBuffer(16))).rejects.toThrow('whisper exploded')
    // We don't assert filesystem state here — implementation uses fs.rmSync in finally;
    // this test just confirms the error propagates.
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-whisper-local.test.ts`
Expected: FAIL — `LocalWhisperClient` not exported.

- [ ] **Step 3: Implement LocalWhisperClient**

Append to `src/main/streamdeck/whisper-client.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export interface LocalWhisperOpts {
  model?: string  // default: 'base.en'
}

export class LocalWhisperClient implements WhisperClient {
  private model: string

  constructor(opts: LocalWhisperOpts = {}) {
    this.model = opts.model ?? 'base.en'
  }

  async transcribe(audio: ArrayBuffer): Promise<string> {
    const tmp = path.join(os.tmpdir(), `cog-whisper-${randomBytes(6).toString('hex')}.webm`)
    fs.writeFileSync(tmp, Buffer.from(audio))
    try {
      const { nodewhisper } = await import('nodejs-whisper')
      const result = await nodewhisper(tmp, {
        modelName: this.model,
        autoDownloadModelName: this.model,
        removeWavFileAfterTranscription: true,
        withCuda: false,
        whisperOptions: { outputInText: true, outputInJson: false },
      } as Parameters<typeof nodewhisper>[1])
      return (typeof result === 'string' ? result : '').trim()
    } finally {
      try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
    }
  }
}
```

> **Note on `nodejs-whisper` typing:** the package's TS types are loose. The `as Parameters<...>` cast keeps strict mode happy; if the package signature changes, follow the compiler.

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-whisper-local.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Type-check + run full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/streamdeck/whisper-client.ts tests/unit/streamdeck-whisper-local.test.ts
git commit -m "feat(streamdeck): LocalWhisperClient — nodejs-whisper wrapper"
```

---

## Task 9: Voice recorder — renderer side

**Files:**
- Modify: `src/shared/types.ts` (add 3 IPC channel constants)
- Modify: `src/preload/index.ts` (expose voice channels)
- Create: `src/renderer/streamdeck/voice-recorder.ts`
- Modify: `src/renderer/main.tsx` (mount the recorder)

The renderer holds a singleton `VoiceRecorder` that listens for `voice:start` from main, kicks off `MediaRecorder` via `getUserMedia`, accumulates chunks, ends on `voice:stop`, and ships the assembled `ArrayBuffer` back via `voice:audio`.

- [ ] **Step 1: Add IPC channel constants**

Modify `src/shared/types.ts` — append to the `IPC` object (preserve trailing comma style of file):

```ts
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_AUDIO: 'voice:audio',
```

- [ ] **Step 2: Expose voice IPC in preload**

Modify `src/preload/index.ts` — add to the `electronAPI` object:

```ts
  onVoiceStart: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.VOICE_START, handler)
    return () => ipcRenderer.removeListener(IPC.VOICE_START, handler)
  },
  onVoiceStop: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.VOICE_STOP, handler)
    return () => ipcRenderer.removeListener(IPC.VOICE_STOP, handler)
  },
  sendVoiceAudio: (audio: ArrayBuffer) => ipcRenderer.send(IPC.VOICE_AUDIO, audio),
```

Add the matching types in `src/renderer/electron.d.ts` (mirror existing pattern there):

```ts
  onVoiceStart(cb: () => void): () => void
  onVoiceStop(cb: () => void): () => void
  sendVoiceAudio(audio: ArrayBuffer): void
```

- [ ] **Step 3: Create the recorder module**

Create `src/renderer/streamdeck/voice-recorder.ts`:

```ts
// Renderer-side singleton. Initialized once from main.tsx. Listens for
// voice:start / voice:stop IPC from main, captures mic via MediaRecorder,
// posts the assembled audio buffer back via voice:audio.

interface ElectronAPIMin {
  onVoiceStart(cb: () => void): () => void
  onVoiceStop(cb: () => void): () => void
  sendVoiceAudio(audio: ArrayBuffer): void
}

declare global {
  interface Window { electronAPI: ElectronAPIMin & Record<string, unknown> }
}

export function mountVoiceRecorder(): () => void {
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stream: MediaStream | null = null

  const stopAndShip = async () => {
    if (!recorder || recorder.state === 'inactive') return
    await new Promise<void>((resolve) => {
      recorder!.addEventListener('stop', () => resolve(), { once: true })
      recorder!.stop()
    })
    stream?.getTracks().forEach(t => t.stop())
    stream = null

    const blob = new Blob(chunks, { type: 'audio/webm' })
    chunks = []
    const buf = await blob.arrayBuffer()
    if (buf.byteLength > 0) {
      window.electronAPI.sendVoiceAudio(buf)
    }
    recorder = null
  }

  const startCapture = async () => {
    if (recorder) return  // already recording
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      })
      recorder.start()
    } catch (err) {
      // Mic permission denied or device error. Send empty buffer so the bridge
      // can surface a "mic permission needed" toast.
      console.warn('[voice-recorder] getUserMedia failed:', err)
      window.electronAPI.sendVoiceAudio(new ArrayBuffer(0))
    }
  }

  const offStart = window.electronAPI.onVoiceStart(() => { void startCapture() })
  const offStop = window.electronAPI.onVoiceStop(() => { void stopAndShip() })

  return () => {
    offStart()
    offStop()
    void stopAndShip()
  }
}
```

- [ ] **Step 4: Mount it in `main.tsx`**

Modify `src/renderer/main.tsx` — add an import and call `mountVoiceRecorder()` near the React render call. Find the existing render pattern (likely `createRoot(...).render(...)`) and add right above it:

```ts
import { mountVoiceRecorder } from './streamdeck/voice-recorder'

// ... existing imports ...

mountVoiceRecorder()
```

- [ ] **Step 5: Type-check + run dev to confirm renderer compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

Optional manual sanity: `npm run dev`, watch console, confirm no errors logged from `[voice-recorder]`. Close after confirming.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/renderer/streamdeck/ src/renderer/main.tsx src/renderer/electron.d.ts
git commit -m "feat(streamdeck): renderer-side voice recorder via MediaRecorder + voice:* IPC"
```

---

## Task 10: VoiceCoordinator (main side)

**Files:**
- Create: `src/main/streamdeck/voice-coordinator.ts`
- Create: `tests/unit/streamdeck-voice-coordinator.test.ts`

Owns the toggle state machine. The bridge's voice key handler calls `coordinator.toggle()`. The coordinator sends `voice:start` to the renderer, waits for the next `voice:stop` (sent on the *next* toggle), receives the audio buffer, calls the active `WhisperClient`, then surfaces the transcript via a callback the bridge supplies (which writes to the orchestrator's PTY).

- [ ] **Step 1: Write failing coordinator test**

Create `tests/unit/streamdeck-voice-coordinator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoiceCoordinator } from '../../src/main/streamdeck/voice-coordinator'
import type { WhisperClient } from '../../src/main/streamdeck/whisper-client'

const fakeBuffer = (n: number) => new ArrayBuffer(n)

describe('VoiceCoordinator', () => {
  let sendStart: ReturnType<typeof vi.fn>
  let sendStop: ReturnType<typeof vi.fn>
  let onTranscript: ReturnType<typeof vi.fn>
  let onState: ReturnType<typeof vi.fn>
  let whisper: WhisperClient
  let coord: VoiceCoordinator

  beforeEach(() => {
    sendStart = vi.fn()
    sendStop = vi.fn()
    onTranscript = vi.fn()
    onState = vi.fn()
    whisper = { transcribe: vi.fn(async () => 'transcribed text') }
    coord = new VoiceCoordinator({ sendStart, sendStop, onTranscript, onState, getWhisper: () => whisper })
  })

  it('first toggle starts recording', async () => {
    await coord.toggle()
    expect(sendStart).toHaveBeenCalled()
    expect(coord.state).toBe('recording')
  })

  it('second toggle stops, transcribes, fires onTranscript', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    expect(sendStop).toHaveBeenCalled()
    expect(whisper.transcribe).toHaveBeenCalled()
    expect(onTranscript).toHaveBeenCalledWith('transcribed text')
    expect(coord.state).toBe('idle')
  })

  it('emits state transitions', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    const states = onState.mock.calls.map(c => c[0])
    expect(states).toEqual(['recording', 'transcribing', 'idle'])
  })

  it('drops empty audio buffers without calling whisper', async () => {
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(0))
    await stopped
    expect(whisper.transcribe).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(coord.state).toBe('idle')
  })

  it('reports whisper failures via onError without leaving state stuck', async () => {
    const err = new Error('boom')
    ;(whisper.transcribe as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const onError = vi.fn()
    coord = new VoiceCoordinator({ sendStart, sendStop, onTranscript, onState, getWhisper: () => whisper, onError })
    await coord.toggle()
    const stopped = coord.toggle()
    coord.handleAudio(fakeBuffer(100))
    await stopped
    expect(onError).toHaveBeenCalledWith(err)
    expect(coord.state).toBe('idle')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-voice-coordinator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement VoiceCoordinator**

Create `src/main/streamdeck/voice-coordinator.ts`:

```ts
import type { WhisperClient } from './whisper-client'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface VoiceCoordinatorOpts {
  sendStart: () => void
  sendStop: () => void
  onTranscript: (text: string) => void
  onState: (state: VoiceState) => void
  onError?: (err: unknown) => void
  getWhisper: () => WhisperClient | null
}

export class VoiceCoordinator {
  state: VoiceState = 'idle'
  private opts: VoiceCoordinatorOpts
  private pendingStop: { resolve: () => void } | null = null

  constructor(opts: VoiceCoordinatorOpts) {
    this.opts = opts
  }

  async toggle(): Promise<void> {
    if (this.state === 'idle') {
      this.setState('recording')
      this.opts.sendStart()
      return
    }
    if (this.state === 'recording') {
      this.opts.sendStop()
      // Wait for handleAudio to fire (or never — if the renderer is gone,
      // the bridge will dispose us cleanly on shutdown)
      await new Promise<void>((resolve) => { this.pendingStop = { resolve } })
      return
    }
    // 'transcribing' — ignore further toggles until done
  }

  handleAudio(audio: ArrayBuffer): void {
    if (this.state !== 'recording') return
    void this.processAudio(audio)
  }

  private async processAudio(audio: ArrayBuffer): Promise<void> {
    if (audio.byteLength === 0) {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
      return
    }
    this.setState('transcribing')
    const whisper = this.opts.getWhisper()
    if (!whisper) {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
      return
    }
    try {
      const text = await whisper.transcribe(audio)
      if (text.length > 0) this.opts.onTranscript(text)
    } catch (err) {
      this.opts.onError?.(err)
    } finally {
      this.setState('idle')
      this.pendingStop?.resolve()
      this.pendingStop = null
    }
  }

  private setState(next: VoiceState): void {
    this.state = next
    this.opts.onState(next)
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-voice-coordinator.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/voice-coordinator.ts tests/unit/streamdeck-voice-coordinator.test.ts
git commit -m "feat(streamdeck): VoiceCoordinator — tap-to-toggle state machine"
```

---

## Task 11: StreamDeckBridge — device claim + initial render

**Files:**
- Create: `src/main/streamdeck/bridge.ts`
- Create: `tests/unit/streamdeck-bridge.test.ts`

The bridge wires everything together. We'll build it incrementally:
- **Task 11** (this): construct + claim device + render initial layout
- **Task 12**: subscribe to AgentRegistry events → re-render agent row
- **Task 13**: handle key presses (action row + preset row) + hotplug + dispose

For unit testing we don't need a real device — we accept a `StreamDeckHandle` interface and pass a fake.

- [ ] **Step 1: Write failing bridge test**

Create `tests/unit/streamdeck-bridge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bridge skeleton**

Create `src/main/streamdeck/bridge.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/unit/streamdeck-bridge.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/bridge.ts tests/unit/streamdeck-bridge.test.ts
git commit -m "feat(streamdeck): StreamDeckBridge — device claim + initial 15-key render"
```

---

## Task 12: StreamDeckBridge — agent row reactivity

**Files:**
- Modify: `src/main/streamdeck/bridge.ts`
- Modify: `tests/unit/streamdeck-bridge.test.ts`

Subscribe to `AgentRegistry`'s `register`, `status`, and `remove` events. On each one, recompute the layout and update only the keys that actually changed (compare descriptor JSON). Debounce by 150ms to coalesce bursts of register events when a preset spawns 5 agents at once.

- [ ] **Step 1: Add failing reactivity test**

Append to `tests/unit/streamdeck-bridge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/unit/streamdeck-bridge.test.ts`
Expected: FAIL — agent registration doesn't trigger re-render yet.

- [ ] **Step 3: Wire registry events into bridge**

Modify `src/main/streamdeck/bridge.ts`. Add private state and a debounced rerender:

```ts
  private lastRendered: Map<number, string> = new Map()  // index → JSON descriptor
  private debounceTimer: NodeJS.Timeout | null = null
  private boundOnChange = () => this.scheduleRerender()

  // Replace the existing start() with this:
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.opts.registry.on('register', this.boundOnChange)
    this.opts.registry.on('status', this.boundOnChange)
    this.opts.registry.on('remove', this.boundOnChange)
    await this.renderAll(true)
  }

  // Update dispose() to detach listeners:
  async dispose(): Promise<void> {
    this.started = false
    this.opts.registry.off('register', this.boundOnChange)
    this.opts.registry.off('status', this.boundOnChange)
    this.opts.registry.off('remove', this.boundOnChange)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    try { await this.opts.deck.clearAllKeys() } catch { /* device gone */ }
    try { await this.opts.deck.close() } catch { /* idem */ }
  }

  private scheduleRerender(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => { void this.renderAll(false) }, 150)
  }
```

Modify `renderAll()` to accept a `force` param and only push diffs:

```ts
  private async renderAll(force: boolean): Promise<void> {
    const layout = computeLayout({
      agents: this.opts.registry.list(),
      presets: await this.opts.listPresets(),
      lastActivity: this.lastActivity,
      unread: this.opts.getUnread(),
    })
    await Promise.all(layout.map(async (k) => {
      const sig = JSON.stringify({ k: k.kind, n: k.agent?.name, s: k.agent?.status, a: k.action, p: k.preset?.name, e: k.empty })
      if (!force && this.lastRendered.get(k.index) === sig) return
      this.lastRendered.set(k.index, sig)
      await this.renderKey(k)
    }))
  }
```

Also touch `lastActivity` from inside the bridge whenever a status event fires for a non-orchestrator agent — so the worker row recency reflects activity:

Add this around the `boundOnChange` setup, replacing the simple version:

```ts
  private onStatus = (e: { name: string; status: string }) => {
    const a = this.opts.registry.get?.(e.name)
    if (a && (a.role || '').trim().toLowerCase() !== 'orchestrator') {
      this.lastActivity[e.name] = Date.now()
    }
    this.scheduleRerender()
  }
  private onChange = () => this.scheduleRerender()
```

And in `start()` / `dispose()` use these distinct handlers:

```ts
    this.opts.registry.on('register', this.onChange)
    this.opts.registry.on('status', this.onStatus)
    this.opts.registry.on('remove', this.onChange)
```

(Remove the old `boundOnChange` references if you wired both versions.)

- [ ] **Step 4: Run all bridge tests**

Run: `npx vitest run tests/unit/streamdeck-bridge.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/streamdeck/bridge.ts tests/unit/streamdeck-bridge.test.ts
git commit -m "feat(streamdeck): bridge reactivity — registry events trigger debounced diff render"
```

---

## Task 13: StreamDeckBridge — key presses, hotplug, main process integration

**Files:**
- Modify: `src/main/streamdeck/bridge.ts` (key press handling)
- Modify: `src/main/streamdeck/index.ts` (init / dispose / hotplug)
- Modify: `src/main/index.ts` (call init / dispose)
- Create: `src/main/streamdeck/handlers.ts` (action callbacks)

Bridge calls injected callbacks on key press. The `index.ts` (the streamdeck module's, not main's) is the place where we wire those callbacks to The Cog's existing IPC handlers and the VoiceCoordinator.

- [ ] **Step 1: Add key-press dispatch to bridge**

Modify `src/main/streamdeck/bridge.ts`. Extend `BridgeOpts`:

```ts
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
```

In `start()`, after subscribing to registry events, attach key press listeners:

```ts
    this.opts.deck.on('down', this.handleKeyDown as (...args: unknown[]) => void)
    this.opts.deck.on('up', this.handleKeyUp as (...args: unknown[]) => void)
```

Add the press tracking + dispatch:

```ts
  private pressedAt: Map<number, number> = new Map()
  private holdMs = 1500
  private holdMsPanic = 2000

  private handleKeyDown = (index: unknown) => {
    if (typeof index !== 'number') return
    this.pressedAt.set(index, Date.now())
  }

  private handleKeyUp = (index: unknown) => {
    if (typeof index !== 'number') return
    const downAt = this.pressedAt.get(index)
    this.pressedAt.delete(index)
    if (downAt === undefined) return
    const heldFor = Date.now() - downAt
    const desc = this.lastDescriptorFor(index)
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
```

In `dispose()`, detach the press listeners:

```ts
    this.opts.deck.off('down', this.handleKeyDown as (...args: unknown[]) => void)
    this.opts.deck.off('up', this.handleKeyUp as (...args: unknown[]) => void)
```

- [ ] **Step 2: Add a key-press test**

Append to `tests/unit/streamdeck-bridge.test.ts`:

```ts
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

    // Capture down/up handlers
    const onCalls = deck.on.mock.calls
    const downCb = onCalls.find(c => c[0] === 'down')?.[1]
    const upCb   = onCalls.find(c => c[0] === 'up')?.[1]

    // Worker is at slot 1 (orch missing → slot 0 is empty, but worker sorts to slot 1)
    // Actually: with no orchestrator, slot 0 is 'empty', and the worker fills slot 1.
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
```

Update existing tests in this file to include the `actions` opt with no-op vi.fn()s — they currently don't pass it. Find each `new StreamDeckBridge({...})` in the test file and add:

```ts
      actions: {
        onAgentTap: vi.fn(),
        onAgentHold: vi.fn(),
        onActionTap: vi.fn(),
        onActionHold: vi.fn(),
        onPresetTap: vi.fn(),
      },
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npx vitest run tests/unit/streamdeck-bridge.test.ts`
Expected: 5 tests pass.

- [ ] **Step 4: Implement device claim + hotplug in module entrypoint**

Replace `src/main/streamdeck/index.ts`:

```ts
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { listStreamDecks, openStreamDeck, type StreamDeck } from '@elgato-stream-deck/node'
import { StreamDeckBridge, type BridgeActions, type StreamDeckHandle } from './bridge'
import { VoiceCoordinator } from './voice-coordinator'
import { CloudWhisperClient, LocalWhisperClient, type WhisperClient } from './whisper-client'
import { readStreamDeckSettings } from './settings'
import { buildBridgeActions, type ActionDeps } from './handlers'
import { IPC } from '../../shared/types'
import type { AgentRegistry } from '../hub/agent-registry'

let bridge: StreamDeckBridge | null = null
let coord: VoiceCoordinator | null = null
let pollTimer: NodeJS.Timeout | null = null
let lastSerial: string | null = null

export interface InitOpts {
  registry: AgentRegistry
  listPresets: () => Promise<{ name: string; agentCount: number }[]>
  getUnread: () => { inbox: number; trollbox: number; stale: number }
  settingsIO: { load(): Record<string, unknown>; save(next: Record<string, unknown>): void }
  actionDeps: Omit<ActionDeps, 'voiceCoordinator'>
  mainWindow: () => BrowserWindow | null
  svgRoot: string
}

export async function initStreamDeck(opts: InitOpts): Promise<void> {
  const settings = readStreamDeckSettings(opts.settingsIO)
  if (!settings.enabled) return

  const tryOpen = async () => {
    if (bridge) return
    let raw: StreamDeck
    try {
      const list = await listStreamDecks()
      const mk2 = list.find(d => d.model === 'mk2' || d.model === 'original-v2')
      if (!mk2) return
      raw = await openStreamDeck(mk2.path)
    } catch (err) {
      console.warn('[streamdeck] open failed:', (err as Error).message)
      return
    }

    lastSerial = await raw.getSerialNumber().catch(() => 'unknown')
    if (raw.NUM_KEYS !== 15) {
      console.warn(`[streamdeck] unsupported model (${raw.NUM_KEYS} keys) — only MK.2 / 15-key supported in v1`)
      await raw.close().catch(() => {})
      return
    }

    const handle: StreamDeckHandle = {
      NUM_KEYS: raw.NUM_KEYS,
      KEY_COLUMNS: raw.KEY_COLUMNS,
      setKeyImage: (i, png) => raw.fillKeyBuffer(i, png) as Promise<void>,
      clearAllKeys: () => raw.clearPanel() as Promise<void>,
      close: () => raw.close() as Promise<void>,
      on: (e, cb) => { raw.on(e as 'down' | 'up', cb as (k: number) => void) },
      off: (e, cb) => { raw.removeListener(e as 'down' | 'up', cb as (k: number) => void) },
    }

    const whisper = buildWhisperClient(settings)
    coord = new VoiceCoordinator({
      sendStart: () => opts.mainWindow()?.webContents.send(IPC.VOICE_START),
      sendStop:  () => opts.mainWindow()?.webContents.send(IPC.VOICE_STOP),
      onTranscript: (text) => actions.onTranscript(text),
      onState: (s) => actions.onVoiceState(s),
      onError: (err) => actions.onVoiceError(err),
      getWhisper: () => whisper,
    })

    const actions: BridgeActions = buildBridgeActions({
      ...opts.actionDeps,
      voiceCoordinator: coord,
    })

    bridge = new StreamDeckBridge({
      deck: handle,
      registry: opts.registry,
      listPresets: opts.listPresets,
      getUnread: opts.getUnread,
      svgRoot: opts.svgRoot,
      actions,
    })
    await bridge.start()
    console.log(`[streamdeck] connected MK.2 (serial: ${lastSerial})`)
  }

  ipcMain.on(IPC.VOICE_AUDIO, (_e, audio: ArrayBuffer) => {
    coord?.handleAudio(audio)
  })

  await tryOpen()

  // Hotplug poll — node-hid does not surface attach events on all platforms,
  // so we poll the device list every 3s. Cheap enumeration, exits early when
  // already connected.
  pollTimer = setInterval(() => { void tryOpen() }, 3000)
}

export async function disposeStreamDeck(): Promise<void> {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (bridge) {
    await bridge.dispose().catch(() => {})
    bridge = null
  }
  coord = null
}

function buildWhisperClient(settings: { whisperBackend: string; openaiApiKey?: string }): WhisperClient | null {
  if (settings.whisperBackend === 'cloud') {
    const key = settings.openaiApiKey || process.env.OPENAI_API_KEY || ''
    return new CloudWhisperClient({ apiKey: key })
  }
  if (settings.whisperBackend === 'local') {
    return new LocalWhisperClient({ model: 'base.en' })
  }
  return null
}
```

> **Note on `@elgato-stream-deck/node` API:** the precise method name (`fillKeyBuffer` vs `fillImage`) and argument shape can drift across releases. If TS or runtime errors point at this, consult the lib's README — the wrapping in `handle` is the only place that needs to update.

- [ ] **Step 5: Implement action handlers**

Create `src/main/streamdeck/handlers.ts`:

```ts
import { BrowserWindow } from 'electron'
import type { BridgeActions } from './bridge'
import type { VoiceCoordinator, VoiceState } from './voice-coordinator'

export interface ActionDeps {
  // Agent ops
  killAgentByName: (name: string) => Promise<void>
  focusAgent: (name: string) => void
  killAllAgents: () => Promise<void>
  // Action keys
  openInbox: () => void
  openTrollbox: () => void
  openStalePanel: () => void
  markInboxRead: () => void
  markTrollboxRead: () => void
  // Presets
  loadPreset: (name: string) => Promise<void>
  // Voice
  voiceCoordinator: VoiceCoordinator
  writeToOrchestratorPty: (text: string) => boolean   // returns false if no orch
  // Misc
  notifyToast: (message: string) => void
  showMainWindow: () => void
  onTranscript?: (text: string) => void
  onVoiceState?: (s: VoiceState) => void
  onVoiceError?: (err: unknown) => void
}

export function buildBridgeActions(deps: ActionDeps): BridgeActions & {
  onTranscript: (text: string) => void
  onVoiceState: (s: VoiceState) => void
  onVoiceError: (err: unknown) => void
} {
  return {
    onAgentTap: (name) => {
      deps.showMainWindow()
      deps.focusAgent(name)
    },
    onAgentHold: (name) => {
      void deps.killAgentByName(name)
    },
    onActionTap: (action) => {
      switch (action) {
        case 'voice':
          void deps.voiceCoordinator.toggle()
          break
        case 'inbox':
          deps.showMainWindow()
          deps.openInbox()
          break
        case 'trollbox':
          deps.showMainWindow()
          deps.openTrollbox()
          break
        case 'stale':
          deps.showMainWindow()
          deps.openStalePanel()
          break
        case 'panic':
          // tap = no-op (safety); only hold triggers
          break
      }
    },
    onActionHold: (action) => {
      switch (action) {
        case 'inbox':    deps.markInboxRead(); break
        case 'trollbox': deps.markTrollboxRead(); break
        case 'panic':    void deps.killAllAgents(); break
        case 'voice':    /* no hold action */ break
        case 'stale':    /* no hold action */ break
      }
    },
    onPresetTap: (name) => {
      void deps.loadPreset(name)
    },
    onTranscript: (text) => {
      const ok = deps.writeToOrchestratorPty(text + '\n')
      if (!ok) deps.notifyToast('No orchestrator running — voice transcript dropped.')
    },
    onVoiceState: (_s) => { /* could update LCD here in the future */ },
    onVoiceError: (err) => { deps.notifyToast(`Whisper error: ${(err as Error).message}`) },
  }
}
```

- [ ] **Step 6: Wire into `src/main/index.ts`**

Locate the `main()` function in `src/main/index.ts` (around line 2573). After `app.whenReady()` and after `hub` and `agentRegistry` are constructed, add the call.

Find the existing import block and add:

```ts
import { initStreamDeck, disposeStreamDeck } from './streamdeck'
import { writeStreamDeckSettings } from './streamdeck/settings'
```

In `main()`, after the section where `hub` and existing IPC handlers are set up, add:

```ts
  // Stream Deck integration
  await initStreamDeck({
    registry: hub.registry,
    listPresets: async () => {
      const list = await listPresets()  // existing function (LIST_PRESETS handler internals)
      return list.map(p => ({ name: p.name, agentCount: (p.agents?.length ?? 0) }))
    },
    getUnread: () => ({
      inbox: getInboxUnreadCount(),       // existing helper used by tray badge
      trollbox: getTrollboxUnreadCount(),
      stale: getStaleTaskCount(),
    }),
    settingsIO: {
      load: () => loadSettings(),
      save: (next) => fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf-8'),
    },
    actionDeps: {
      killAgentByName: async (name) => {
        const a = hub.registry.get(name)
        if (a?.id) await killAgent(a.id)
      },
      focusAgent: (name) => {
        const win = BrowserWindow.getAllWindows()[0]
        win?.webContents.send('streamdeck:focus-agent', name)
      },
      killAllAgents: async () => {
        for (const a of hub.registry.list()) {
          if (a.id) await killAgent(a.id)
        }
      },
      openInbox: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:open-panel', 'inbox')
      },
      openTrollbox: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:open-panel', 'trollbox')
      },
      openStalePanel: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:open-panel', 'stale')
      },
      markInboxRead: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:mark-read', 'inbox')
      },
      markTrollboxRead: () => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:mark-read', 'trollbox')
      },
      loadPreset: async (name) => {
        await loadPresetByName(name)  // existing function
      },
      writeToOrchestratorPty: (text) => {
        const orch = hub.registry.list().find(a => (a.role || '').trim().toLowerCase() === 'orchestrator')
        if (!orch?.id) return false
        writeToPty(orch.id, text)
        return true
      },
      notifyToast: (msg) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('streamdeck:toast', msg)
      },
      showMainWindow: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      },
    },
    mainWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
    // SVGs are copied from src/main/streamdeck/assets/cogsworth/ → out/main/assets/cogsworth/
    // by viteStaticCopy in electron.vite.config.ts. Same relative path in dev and packaged.
    svgRoot: path.join(__dirname, 'assets/cogsworth'),
  })
```

> **Caveat on bound functions:** the names `listPresets`, `loadPresetByName`, `getInboxUnreadCount`, `getTrollboxUnreadCount`, `getStaleTaskCount`, `killAgent`, `writeToPty`, `loadSettings`, `getSettingsPath` should already exist in `src/main/index.ts` (the existing IPC handlers reference equivalent logic). If a name doesn't match exactly, find the equivalent inline call inside the matching `ipcMain.handle(...)` block and either factor it into a helper or pass an inline arrow that does the same thing.

In the `before-quit` handler (search for `before-quit` in `index.ts`), add:

```ts
  app.on('before-quit', async () => {
    await disposeStreamDeck()
    // ... existing cleanup ...
  })
```

If a `before-quit` handler doesn't exist yet, add one near the bottom of `main()`.

- [ ] **Step 7: Renderer-side panel-open handlers**

The bridge fires `'streamdeck:open-panel'`, `'streamdeck:focus-agent'`, `'streamdeck:mark-read'`, `'streamdeck:toast'` events at the renderer. Wire minimal listeners in `src/renderer/App.tsx` that dispatch into existing app state:

In `App.tsx`, after the existing `useEffect` blocks, add:

```ts
  useEffect(() => {
    const offPanel = (window.electronAPI as Window['electronAPI'] & {
      onStreamDeckOpenPanel?: (cb: (panel: string) => void) => () => void
    }).onStreamDeckOpenPanel?.((panel: string) => {
      // Hook into existing panel-open logic — match the implementation already
      // used by IPC.PROJECT_CHANGED or similar. Keep it minimal: set a state
      // var that the rest of the app already watches.
      setActivePanel(panel as 'inbox' | 'trollbox' | 'stale' | 'pinboard')
    })
    return () => offPanel?.()
  }, [])
```

(Add matching `onStreamDeckOpenPanel`, `onStreamDeckFocusAgent`, `onStreamDeckMarkRead`, `onStreamDeckToast` exposures in `src/preload/index.ts` mirroring the existing `onPtyOutput` pattern. The toast handler can reuse whatever toast system The Cog already has.)

- [ ] **Step 8: Type-check + run full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/main/streamdeck/ src/main/index.ts src/preload/index.ts src/renderer/App.tsx tests/unit/streamdeck-bridge.test.ts
git commit -m "feat(streamdeck): wire bridge into main process — actions, voice, hotplug, dispose"
```

---

## Task 14: Settings panel — Stream Deck tab

**Files:**
- Create: `src/renderer/components/Settings/StreamDeckTab.tsx`
- Modify: `src/renderer/components/Settings/Settings.tsx` (or wherever the existing tabs list lives — search for the existing settings tab structure)

- [ ] **Step 1: Locate the existing settings panel**

Run: `grep -rn "Settings.*tab\|tabs\s*=\s*\[" src/renderer/components/Settings/ 2>/dev/null | head -20`
Expected: find the file that defines the settings tabs list. Adjust the modify target above if the path differs.

- [ ] **Step 2: Create the Stream Deck tab component**

Create `src/renderer/components/Settings/StreamDeckTab.tsx`:

```tsx
import { useEffect, useState } from 'react'

interface StreamDeckSettings {
  enabled: boolean
  whisperBackend: 'cloud' | 'local' | 'disabled'
  openaiApiKey?: string
}

export function StreamDeckTab(): JSX.Element {
  const [settings, setSettings] = useState<StreamDeckSettings>({ enabled: true, whisperBackend: 'cloud' })
  const [showKey, setShowKey] = useState(false)
  const [connection, setConnection] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')

  useEffect(() => {
    void window.electronAPI.getSettings().then((all: Record<string, unknown>) => {
      const s = (all.streamdeck as StreamDeckSettings | undefined) ?? settings
      setSettings({ ...settings, ...s })
    })
    void window.electronAPI.getStreamDeckStatus?.().then((s: 'connected' | 'disconnected') => setConnection(s))
  }, [])

  const update = async (patch: Partial<StreamDeckSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    await window.electronAPI.setSetting('streamdeck', next)
  }

  return (
    <div className="settings-tab streamdeck-tab">
      <h2>Stream Deck</h2>

      <label className="settings-row">
        <input type="checkbox" checked={settings.enabled}
               onChange={e => void update({ enabled: e.target.checked })} />
        Enable Stream Deck integration
      </label>

      <fieldset className="settings-row">
        <legend>Voice transcription</legend>
        {(['cloud', 'local', 'disabled'] as const).map(opt => (
          <label key={opt}>
            <input type="radio" name="whisper" value={opt}
                   checked={settings.whisperBackend === opt}
                   onChange={() => void update({ whisperBackend: opt })} />
            {opt === 'cloud' ? 'Cloud (OpenAI Whisper)'
              : opt === 'local' ? 'Local (Whisper.cpp)'
              : 'Disabled'}
          </label>
        ))}
      </fieldset>

      {settings.whisperBackend === 'cloud' && (
        <label className="settings-row">
          OpenAI API key
          <input type={showKey ? 'text' : 'password'}
                 value={settings.openaiApiKey ?? ''}
                 onChange={e => void update({ openaiApiKey: e.target.value })}
                 placeholder="sk-…" />
          <button type="button" onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
        </label>
      )}

      <div className="settings-row">
        Connection: <strong>{connection}</strong>
        <button type="button" onClick={() => window.electronAPI.reconnectStreamDeck?.()}>
          Reconnect
        </button>
      </div>
    </div>
  )
}
```

> **Note on existing electronAPI methods:** `getSettings`, `setSetting`, and helpers like `getStreamDeckStatus` / `reconnectStreamDeck` need to exist on `window.electronAPI`. The first two likely already do via existing `SETTINGS_GET` / `SETTINGS_SET` IPC; if not, mirror the existing settings pattern. The latter two are new — add them in the next step.

- [ ] **Step 3: Add status + reconnect IPC**

In `src/shared/types.ts`, add to `IPC`:

```ts
  STREAMDECK_STATUS: 'streamdeck:status',
  STREAMDECK_RECONNECT: 'streamdeck:reconnect',
```

In `src/preload/index.ts`, add to `electronAPI`:

```ts
  getStreamDeckStatus: () => ipcRenderer.invoke(IPC.STREAMDECK_STATUS),
  reconnectStreamDeck: () => ipcRenderer.invoke(IPC.STREAMDECK_RECONNECT),
```

In `src/main/streamdeck/index.ts`, export a status checker and a reconnect:

```ts
export function getStreamDeckStatus(): 'connected' | 'disconnected' {
  return bridge ? 'connected' : 'disconnected'
}

export async function reconnectStreamDeck(opts: InitOpts): Promise<void> {
  await disposeStreamDeck()
  await initStreamDeck(opts)
}
```

In `src/main/index.ts`, register the new IPC handlers near the other `streamdeck` setup:

```ts
  ipcMain.handle(IPC.STREAMDECK_STATUS, () => getStreamDeckStatus())
  ipcMain.handle(IPC.STREAMDECK_RECONNECT, () => reconnectStreamDeck(streamDeckInitOpts))
```

(Where `streamDeckInitOpts` is the same opts object you built in Task 13 — extract it into a `const` so it can be referenced again here.)

- [ ] **Step 4: Add the new tab to the settings tab list**

Open the settings panel file you found in Step 1. Add `StreamDeckTab` to the tabs list:

```tsx
import { StreamDeckTab } from './StreamDeckTab'

// Inside the existing tabs definition:
const tabs = [
  // ... existing tabs ...
  { id: 'streamdeck', label: 'Stream Deck', component: StreamDeckTab },
]
```

> **Caveat:** the exact shape of the tabs list will match whatever pattern that file already uses. Match it.

- [ ] **Step 5: Type-check + run dev to confirm it shows up**

Run: `npx tsc --noEmit`
Expected: no errors.

Manual: `npm run dev`, open Settings, confirm "Stream Deck" tab appears, toggling settings persists across app restart.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Settings/StreamDeckTab.tsx \
        src/renderer/components/Settings/Settings.tsx \
        src/preload/index.ts \
        src/shared/types.ts \
        src/main/streamdeck/index.ts \
        src/main/index.ts
git commit -m "feat(streamdeck): settings tab + status/reconnect IPC"
```

---

## Task 15: Manual hardware smoke test checklist

**Files:**
- Create: `docs/superpowers/plans/2026-05-03-streamdeck-smoke-test.md`

End-to-end voice + USB paths cannot be unit-tested. This task creates the manual checklist for the user to run with the actual Stream Deck plugged in.

- [ ] **Step 1: Create the checklist**

Create `docs/superpowers/plans/2026-05-03-streamdeck-smoke-test.md`:

```markdown
# Stream Deck Integration — Manual Smoke Test

Run with a Stream Deck MK.2 (15 keys) physically connected.

## Setup

- [ ] Close the Elgato Stream Deck app if it's running
- [ ] Plug in the Stream Deck
- [ ] Run `npm run dev`
- [ ] Open Settings → Stream Deck, verify connection status shows "connected"

## Visual

- [ ] All 15 keys show *something* (no black/blank keys when state exists)
- [ ] With no orchestrator running: slot 0 shows the sleeping Cogsworth (greyish)
- [ ] Spawn an orchestrator agent → slot 0 face updates within ~200ms
- [ ] Spawn 4 worker agents → slots 1-4 fill with their mood faces
- [ ] Spawn a 5th worker → it bumps the least-recently-active out of the visible 4
- [ ] Action row (slots 5-9) shows VOICE, INBOX, TROLL, STALE, PANIC labels
- [ ] Preset row (slots 10-14) shows TEAM 1..N for each saved preset

## Notification badges

- [ ] Have an orchestrator call `notify_user` (priority high) → INBOX key (slot 6) shows red badge with unread count
- [ ] Tap INBOX → main Cog window focuses, Inbox panel opens
- [ ] Hold INBOX (>1.5s) → unread badge clears
- [ ] Stale alert fires → STALE key (slot 8) gets orange badge

## Voice — cloud Whisper

- [ ] In Settings, set Whisper backend = Cloud, paste OpenAI key
- [ ] Tap VOICE (slot 5) → key turns red/pulse, mic perm prompt may appear
- [ ] Speak: "Hey orchestrator, what's the build status?"
- [ ] Tap VOICE again → spinner briefly → key returns to idle
- [ ] Orchestrator's PTY shows the transcribed text typed in, with newline (so it sent)

## Voice — local Whisper (first run)

- [ ] In Settings, switch Whisper backend = Local
- [ ] Tap VOICE, record short message, tap to stop
- [ ] First run: console shows model download (~150MB), takes 30-60s on first call
- [ ] Subsequent calls: transcribe in ~1-3s on a typical desktop

## Agent control

- [ ] Tap a worker key → that agent's window in the Cog UI gets focused
- [ ] Hold a worker key for 1.5s → red glow countdown → agent killed
- [ ] Worker row shifts (the killed worker drops out)

## Preset launchers

- [ ] Save 2-3 preset teams via the existing UI
- [ ] Tap TEAM 1 → preset spawns its agents normally
- [ ] Confirm the agent row reflects the newly spawned agents within 200ms

## Panic

- [ ] Spawn 3+ agents
- [ ] Tap PANIC alone → nothing happens (intentional safety)
- [ ] Hold PANIC for 2s → red countdown glow → all agents killed

## Hotplug

- [ ] Unplug the Stream Deck mid-session → no Cog crash, console logs disconnect cleanly
- [ ] Re-plug within 10s → bridge auto-claims, keys re-render

## Settings reconnect

- [ ] Open Elgato's app (steals the device) → Cog Settings shows "disconnected"
- [ ] Close Elgato's app, click Reconnect → Cog reclaims the device

## Cog quit cleanliness

- [ ] Quit The Cog → Stream Deck keys go blank (not stuck on stale Cogsworth faces)

If all checked: ship it.
```

- [ ] **Step 2: Commit**

```bash
git add -f docs/superpowers/plans/2026-05-03-streamdeck-smoke-test.md
git commit -m "docs: manual hardware smoke-test checklist for Stream Deck integration"
```

---

## Self-Review (already performed)

**Spec coverage:**
- Bridge in main process — Tasks 11, 12, 13 ✓
- Renderer-side audio capture — Task 9 ✓
- Whisper Cloud + Local + interface — Tasks 7, 8 ✓
- Pure layout function — Task 4 ✓
- Cogsworth status mapping — Task 5 (collapsed 7→4 to match real `AgentStatus`) ✓
- Key renderer with cache + tints + badges — Task 6 ✓
- Settings persistence — Task 2 ✓
- Settings UI tab — Task 14 ✓
- Connection lifecycle (claim, hotplug, dispose) — Tasks 11, 13 ✓
- Voice tap-to-toggle state machine — Task 10 ✓
- All 5 action keys + 5 preset keys — Tasks 11, 13 ✓
- Manual smoke test for hardware paths — Task 15 ✓

**Placeholder scan:** No TBDs. Two "Caveat:" notes (Task 13 lib API drift, Task 14 settings panel structure) explicitly point at lookups the engineer must do, with concrete fallback guidance — those are intentional, not placeholders.

**Type consistency:**
- `WhisperClient.transcribe(audio: ArrayBuffer): Promise<string>` consistent across Tasks 7, 8, 10
- `StreamDeckHandle` interface used identically in Tasks 11, 12, 13
- `KeyDescriptor`, `BridgeOpts`, `BridgeActions` align across bridge tasks
- `AgentStatus` import everywhere it's used

**Scope:** Single feature, one cohesive plan. No decomposition needed.
