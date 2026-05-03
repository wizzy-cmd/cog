# Stream Deck Integration Design

## Goal

Plug an Elgato Stream Deck MK.2 (15 keys) into The Cog and turn it into a physical
"command bridge" for the user's agent fleet. The deck shows live agent statuses
via Cogsworth mood faces, exposes one-tap controls for inbox/trollbox/stale/panic,
launches saved preset teams, and acts as a push-to-talk voice channel that pipes
transcribed speech directly into the orchestrator's PTY.

The orchestrator is already a first-class concept in The Cog
(`agents.find(a => a.role === 'orchestrator')` gets the `notify_user` and
`propose_team` tools). This design treats the orchestrator as the user's
primary conversation partner and pins it to a fixed Stream Deck slot.

Scope is v1 only:
- 15-key MK.2 hardware variant
- One Stream Deck per Cog instance
- Visual-only inbound notifications (no TTS)
- Voice input → orchestrator PTY only (no per-agent voice routing)

Layout configurability, multi-page profiles, additional Stream Deck models
(Mini / XL / + / Neo), and TTS readback are explicitly out of scope for v1.

## Hardware

- **Model:** Stream Deck MK.2 (15 keys, 3 rows × 5 cols, 72×72px LCDs)
- **Connection:** USB HID, claimed directly via `@elgato-stream-deck/node` —
  no Stream Deck plugin install, no Elgato software dependency
- **One owner at a time:** Windows/macOS HID grants exclusive access. If Elgato's
  app or another Cog instance has the device, our claim fails cleanly.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  The Cog (Electron main process)                 │
│  ┌──────────────────────────────────────────┐    │
│  │ src/main/streamdeck/                     │    │
│  │   bridge.ts         — owns device, state │    │
│  │   key-renderer.ts   — SVG → 72×72 PNG    │    │
│  │   voice-recorder.ts — IPC to renderer    │    │
│  │   whisper-client.ts — Cloud + Local STT  │    │
│  └──────────────────────────────────────────┘    │
│            ↕ existing IPC + events ↕             │
│  ┌──────────────────────────────────────────┐    │
│  │ Existing surfaces (no new IPC needed):   │    │
│  │  agentRegistry, inbox, trollbox,         │    │
│  │  pinboard (stale tasks), presets,        │    │
│  │  WRITE_TO_PTY, SPAWN_AGENT, KILL_AGENT,  │    │
│  │  LOAD_PRESET                             │    │
│  └──────────────────────────────────────────┘    │
│            ↕ new IPC for voice only ↕            │
│  ┌──────────────────────────────────────────┐    │
│  │ Renderer (existing main BrowserWindow)   │    │
│  │   voice:start / voice:stop handlers      │    │
│  │   MediaRecorder via getUserMedia         │    │
│  │   posts ArrayBuffer back via voice:audio │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
            ↕ USB HID
        🟦 Stream Deck MK.2
```

**Why main process:** The deck must stay live when the Cog window is minimized
or hidden, USB HID requires Node access (the renderer cannot open HID), and
all the data the keys need (agent registry, inbox, presets, stale alerts)
already lives in the main process. The bridge is an alternative consumer of
the same state the React UI consumes — not a parallel state system.

**Why renderer-side audio capture:** Avoids native audio bindings. Electron
ships `MediaRecorder` + `getUserMedia` in every BrowserWindow. The OS-native
mic permission prompt is already wired up. The bridge orchestrates start/stop
from main; the renderer captures and ships the audio buffer back.

**No new IPC for the deck itself.** The bridge subscribes to existing event
emitters (agent registry changes, inbox new, stale alerts, trollbox unread)
and calls existing IPC handlers. The only new IPC channels are the three
voice-recording ones (`voice:start`, `voice:stop`, `voice:audio`).

## Key Layout

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│   ORCH   │  WRK 2   │  WRK 3   │  WRK 4   │  WRK 5   │  Row 1
│ 🎭 mood  │  mood    │  mood    │  mood    │  mood    │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│   🎙️    │   🔔     │   🍿     │   ⚠️     │   🛑     │  Row 2
│  VOICE   │  INBOX   │  TROLL   │  STALE   │  PANIC   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ TEAM 1   │ TEAM 2   │ TEAM 3   │ TEAM 4   │ TEAM 5   │  Row 3
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### Row 1 — Agents

| Slot | Source | Tap | Hold (1.5s) |
|------|--------|-----|-------------|
| 1 (Orchestrator) | `agents.find(a => a.role === 'orchestrator')` — locked | Focus orchestrator window | No-op (deliberately no kill — too dangerous) |
| 2–5 (Workers) | 4 most-recently-active non-orchestrator agents | Focus that agent's window | Kill agent, with red glow countdown during hold |

LCD shows the agent's Cogsworth face based on agent `status`:

| Agent status | Cogsworth SVG |
|--------------|---------------|
| `working`           | cogsworth-focused |
| `thinking` (mid tool use) | cogsworth-thinking |
| `idle` / no task    | cogsworth-neutral |
| `blocked` / stale   | cogsworth-alert (pulses) |
| `error`             | cogsworth-error |
| `done`              | cogsworth-happy |
| `disconnected` / killed | cogsworth-dead (greyscale) |

**"Most-recently-active"** is sorted by the latest of `agent:status` change or
PTY write timestamp. A 30-second debounce prevents the row from thrashing on
every keystroke a worker is typing.

**Empty states:**
- No orchestrator running → slot 1 shows cogsworth-sleeping, tap is no-op
- Fewer than 4 workers → empty worker slots are dim/blank
- More than 4 workers → only the 4 most-recently-active are shown (no paging in v1)

### Row 2 — Actions

| Key | Tap | Hold | LCD state |
|-----|-----|------|-----------|
| 🎙️ Voice | Tap → start recording. Tap again → stop & auto-send to orchestrator. | — | Idle: mic icon. Recording: red pulse. Transcribing: spinner. Disabled (no orch): dim mic. |
| 🔔 Inbox | Focus Cog window + open Inbox panel | Mark all read | Unread badge count, flashes red on `notify_user` |
| 🍿 Trollbox | Focus Cog window + open Trollbox panel | Mark all read | Unread badge count |
| ⚠️ Stale | Open pinboard with stale-tasks filter | — | Pulses orange when `stale_alert` fires, shows count badge |
| 🛑 Panic | No-op (safety) | Hold 2s → KILL ALL AGENTS | Red on hold-progress, otherwise grey |

### Row 3 — Preset launchers

5 saved preset teams from the existing presets system, ordered by save time
(slot 1 = oldest saved). Tap → call existing `LOAD_PRESET` handler and spawn.
LCD shows "TEAM N" with an agent-count badge.

- Fewer than 5 presets → unused slots dim
- More than 5 → only first 5 are mapped (preset reordering / favorites = v2)

### Refresh cadence

- Agent state changes → push render immediately (event-driven, no polling)
- Cogsworth mood face only re-renders when status actually changes
- Unread badges re-render on event
- Worker-row recency recomputes on `agent:status` and on debounced PTY-write

## Voice Flow

```
🎙️ tap (start)
  ↓ bridge sends voice:start IPC → renderer
  ↓ renderer fires up MediaRecorder via getUserMedia
  ↓ LCD: red pulse + "REC"
🎙️ tap (stop)
  ↓ renderer ends MediaRecorder
  ↓ renderer ships Blob → ArrayBuffer back via voice:audio IPC
  ↓ bridge → WhisperClient.transcribe(audio) → text
  ↓ LCD: spinner ⚙️
  ↓ bridge finds orchestrator in registry
  ↓ bridge calls existing WRITE_TO_PTY(orch.id, text + '\n')
  ↓ LCD: ✅ flash 500ms → idle mic
```

**Transcript injection:** uses existing `WRITE_TO_PTY` IPC handler. The
transcript is typed into the orchestrator's PTY exactly as if the user had
typed it in the Cog UI, including the trailing newline to send. Works
uniformly across Claude Code, Kimi, Gemini, Codex — they all consume PTY
input the same way.

**No orchestrator running:** 🎙️ key is dim, tap shows "no orch" on LCD for
1s and recording does not start. Transcripts are not queued for a future
orchestrator (would feel broken).

### Whisper client interface

```ts
// src/main/streamdeck/whisper-client.ts
export interface WhisperClient {
  transcribe(audio: ArrayBuffer): Promise<string>
}

export class CloudWhisperClient implements WhisperClient {
  // POST to OpenAI /v1/audio/transcriptions, model=whisper-1
  // Uses settings.openaiApiKey or process.env.OPENAI_API_KEY
}

export class LocalWhisperClient implements WhisperClient {
  // whisper.cpp via nodejs-whisper, model=base.en (~150MB)
  // Auto-downloads on first use, shows progress on LCD
}
```

The active client is selected from settings on bridge init and rebuilt when
the user changes the toggle.

### Settings panel — new "Stream Deck" tab

- ☑️ **Enable Stream Deck integration** (auto-on if device detected)
- 🔊 **Voice STT:** ◉ Cloud (OpenAI) ○ Local (Whisper.cpp) ○ Disabled
- 🔑 **OpenAI API key** field, only visible when Cloud is selected (masked input with show/hide toggle)
- 🟢 **Connection status:** "Connected to Stream Deck MK.2 (serial: …)" or "No device detected" with [Reconnect] button
- **[Test mic]** button — records 2 seconds, shows volume level meter, no transcription

Settings persist to The Cog's existing global settings file under a new
`streamdeck` namespace.

## Connection Lifecycle

```
app.whenReady()
  → StreamDeckBridge.init()
      ├─ list HID devices via @elgato-stream-deck/node
      ├─ found MK.2? → claim, render initial state, subscribe to events
      └─ none found / wrong model? → log, stay dormant, listen for hotplug
```

- **Hotplug attach:** `node-hid` fires on USB connect → bridge claims and renders
- **Hotplug detach:** bridge releases device cleanly, no errors thrown
- **Cog shutdown:** `before-quit` → bridge clears all keys (Stream Deck firmware
  persists the last image, so a clean blank-out matters), releases device
- **Two Cog instances:** OS exclusive HID — second instance gets `device busy`,
  bridge logs and stays dormant, settings shows "Stream Deck in use"
- **Elgato app running:** same `device busy` story; settings panel surfaces
  "Stream Deck in use by another app, close it and click Reconnect"
- **Wrong Stream Deck model** (Mini/XL/+/Neo): bridge logs "unsupported model
  for v1" and stays dormant. Future versions can add per-model layout maps.

## Image Generation

Cogsworth SVGs (`marketing/cogsworth/cogsworth-*.svg`, 11 faces) rasterize to
72×72 PNG using the existing `@resvg/resvg-js` dependency (already used by
`scripts/build-icons.mjs`). PNGs are cached in memory keyed by
`<svg-name>:<tint-hex>` so we don't re-rasterize on every status tick.

Tint colors layer over the base PNG via simple per-pixel multiply (or just
swap to a pre-tinted variant — implementation detail for the plan):

| State | Tint |
|-------|------|
| working / focused | white (no tint) |
| alert / pulsing   | red |
| disconnected      | greyscale |
| done              | green flash |

Approximate cache size: 11 faces × 4 tints × ~5KB PNG ≈ 220KB. Cheap.

## Error Handling

| Failure | LCD reaction | User feedback |
|---------|--------------|---------------|
| Mic permission denied | Red ⛔ for 2s | Toast: "Mic permission needed" with [Grant] button |
| Cloud STT 4xx/5xx | Red ❌ for 2s | Toast: "Whisper failed: \<reason\>" |
| Cloud STT timeout (>10s) | Red ❌ for 2s | Toast: "Whisper timed out" |
| Local model not downloaded | Spinner during DL | Toast: "Downloading Whisper base.en (150MB)…" |
| Audio empty / silence | Yellow ⚠️ for 1s | None (silent fail; do not call Whisper) |
| Stream Deck unplugged mid-recording | (no LCD — device gone) | None; cancel MediaRecorder, drop buffer |
| Cog crashes mid-recording | (LCD will show last frame until replug — firmware quirk) | None |

**Cost guard for cloud Whisper** (per-day spend cap) is explicitly **out of
scope for v1**. Add later if cost surprises happen in practice.

## Testing

- **Unit:** `whisper-client.ts` — mock OpenAI SDK and `nodejs-whisper`,
  verify transcript shape and error mapping
- **Unit:** `key-renderer.ts` — given a status, returns the right SVG name
  and tint; cache hits don't re-rasterize
- **Unit:** worker-row recency sort — given a list of agents and timestamps,
  returns the right top-4 in the right order, debounce respected
- **Integration:** `bridge.ts` with a mocked Stream Deck device — verify that
  agent registry events trigger the right key updates, that key presses
  translate to the right IPC calls
- **Manual / hardware:** the only path that genuinely needs a physical device
  is end-to-end voice (mic capture → Whisper → PTY write). Keep that as a
  manual smoke test; don't try to mock USB.

## Out of Scope (v1)

- Layout customization / button reorder UI
- Multi-page profiles or button modifier (shift, fn) keys
- Stream Deck Mini, XL, +, or Neo support
- TTS readback of orchestrator messages
- Per-agent voice routing (voice always goes to orchestrator)
- Per-day cost guard for cloud Whisper
- Voice transcript review/edit before send (auto-send only)
- Pinning specific agents to worker slots (smart auto-fill only)
- Preset reordering / favorites in row 3

## File Layout

```
src/main/streamdeck/
  bridge.ts            — owns device, key state, event subscriptions
  key-renderer.ts      — SVG → tinted 72×72 PNG, with cache
  voice-recorder.ts    — start/stop coordination with renderer over IPC
  whisper-client.ts    — CloudWhisperClient + LocalWhisperClient + interface
  layout.ts            — pure: agents + state → 15-key descriptor
  index.ts             — public init() called from main entrypoint

src/main/index.ts
  — call streamdeck.init() once on app.whenReady()
  — wire bridge.dispose() in before-quit

src/renderer/voice-recorder.ts (new, small)
  — voice:start / voice:stop IPC handlers, MediaRecorder lifecycle

src/renderer/components/Settings/StreamDeckTab.tsx (new)
  — settings UI for the Stream Deck tab

package.json
  — new deps: @elgato-stream-deck/node, openai (or fetch directly), nodejs-whisper
```
