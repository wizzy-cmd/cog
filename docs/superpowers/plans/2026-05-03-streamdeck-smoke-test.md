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

## Known v1 limitations (not bugs)

- Trollbox unread badge always shows 0 — main process doesn't track trollbox unread yet (renderer-side only). Follow-up work needed to surface the count.
- Stale unread badge always shows 0 — main process doesn't aggregate stale-task counts. Follow-up work.
- App.tsx panel-switching from Stream Deck (`streamdeck:open-panel` IPC) is wired in preload but the actual handler in App.tsx is a TODO stub. Tap INBOX/TROLL/STALE will focus the window but won't auto-open the matching panel until the renderer dispatch is finished.
- Stream Deck Mini (6-key), XL (32-key), +, and Neo are detected and politely declined — only MK.2 is supported in v1.
- TTS readback of orchestrator messages is intentionally out of scope. Voice is input-only.
