# Mobile Inbox + Trollbox + Proposal Accept — Design

**Date:** 2026-05-09
**Author:** Nate (with Claude)
**Status:** Draft — pending user review

## Goal

Bring three already-built backend capabilities to the mobile remote view (`src/main/remote/static/`):

1. **Inbox panel** — unified list of orchestrator notifications and team-spawn proposals, with inline approve / reject for proposals.
2. **Trollbox panel** — read-only chat feed of the desktop crew's chat.
3. **Unread inbox badge** — surfaced on the workshop button (main view) and on the Panels button inside workshop mode.

Today, opening either panel from the mobile workshop "Panels" menu hits the fallback message *"Panel view not available"* in `app.js:830`.

## Scope & Non-Goals

**In scope:**
- Mobile UI for inbox (read, mark-read, approve/reject proposals with optional reject feedback)
- Mobile UI for trollbox (read-only chat feed, online count, paused-state indicator)
- Unread badge wired to the existing `/state` payload (`inboxUnread`)

**Out of scope (explicitly):**
- Posting to trollbox from mobile (read-only by design — see decision log)
- Editing a proposed team before approving (one-tap approve, matches 3DS)
- Server-side changes — every endpoint we need already exists
- Push notifications / OS-level alerts

## Backend Surface (already done — no changes)

`src/main/remote/remote-server.ts` already exposes:

| Method | Path | Notes |
|---|---|---|
| GET  | `/r/:token/state` | already returns `inbox` (recent 20) + `inboxUnread` |
| GET  | `/r/:token/inbox` | full list + unread count |
| POST | `/r/:token/inbox/:id/read` | mark read, idempotent |
| POST | `/r/:token/inbox/:id/respond` | `{action:'approve'\|'reject', feedback?, proposalId?}` |
| GET  | `/r/:token/trollbox` | workshop-gated; returns `{status, onlineCount, messages, pauseUntil, pauseReason}` |

`/r/:token/trollbox/send` exists but is intentionally not used (read-only mobile).

Inbox messages already carry `proposalId`, `proposalSummary`, `proposalAgents`, `proposalStatus` for proposal-wrapped messages, so the renderer can branch on `m.proposalId` without a second roundtrip.

## Files Touched

All under `src/main/remote/static/`:

- `index.html` — add Inbox + Trollbox buttons to the `#workshop-panels` list; add badge spans to the workshop button (main view) and the Panels button (workshop view)
- `app.js` — extend `openPanelDetail()` dispatcher; add `renderPanelInbox()`, `renderPanelTrollbox()`; manage a single `panelPollHandle` for live updates while a panel is open; update badge as a side-effect of the existing `/state` poll
- `style.css` — minor additions for inbox cards, proposal cards, chat lines, badge pill

No other files in the repo are touched.

## Design

### 1. Inbox panel

Renders into the existing `#workshop-panel` overlay (same container that hosts pinboard / info / schedule).

**Header:** `← Inbox  (N unread)   [Read all]`

**List of cards (newest first):**

- Priority chip: HIGH (red) / MEDIUM (yellow) / LOW (green)
- Sender (`agentName`), relative time (e.g. "2m ago")
- Message body
- Unread cards have a left accent strip; tapping anywhere non-button drops the strip and POSTs `/inbox/:id/read`
- **Proposal cards** (when `m.proposalId` is truthy) additionally render:
  - "Proposed team" sub-block listing each `proposalAgents[i]` as `name (cli · role)`
  - `[ Approve ]` and `[ Reject ]` buttons
- **Approve** flow:
  1. Optimistic: card transitions to "Approved · spawning…" state (buttons disabled)
  2. POST `/inbox/:id/respond {action:'approve', proposalId}`
  3. On success: card dims, footer reads "Spawned N agents" (using `result.spawned`)
  4. On failure: restore buttons, surface inline error message
- **Reject** flow:
  1. Tap Reject reveals an inline 1-line text input + Send button (empty allowed)
  2. POST `/inbox/:id/respond {action:'reject', feedback, proposalId}`
  3. On success: card dims, footer reads "Rejected"
  4. On failure: restore input + button, surface error
- "Read all" → loops through visible unread message ids and POSTs `/inbox/:id/read` for each (≤20 items, fine client-side; the dedicated `/inbox/read-all` exists on the hub but not on `remote-server.ts`, and adding it is outside scope)

**Empty state:** centered "No messages."

### 2. Trollbox panel

Renders into the same `#workshop-panel` overlay.

**Header:** `← Trollbox  (N online)   🔴 read-only`

**Body:** message list, oldest-at-top, newest-at-bottom.

- Each line: `nick   HH:MM   text`
- Auto-scroll to bottom on first render; on poll updates, only auto-scroll if the user is already pinned to bottom (don't yank a user who scrolled up to read history)
- Pause state: when `pauseUntil > Date.now()`, insert a divider line "─── paused Nm — {pauseReason} ────"
- If the endpoint returns 503 or `null` state: render "Trollbox not available — desktop hasn't opened it yet"

**No input bar.** No nick handling. Read-only by design.

### 3. Unread badge

Driven entirely by `state.inboxUnread` (already in `/state`).

Two surfaces, same pill component:

- **Main-view workshop button** (`#workshop-btn`): red pill with count appended, hidden when count is 0
- **Workshop-view Panels button** (`#workshop-panels-btn`): same pill
- Inside the Panels menu, the "📬 Inbox" item shows an inline count next to its label
- Counts cap visually at "9+"

No persistent client-side state — server is source of truth.

### 4. Polling lifecycle

- Existing `/state` poll (`fetchState`, every 5s) already runs while the app is alive. Badge updates as a side-effect of `render()`.
- A new module-level `panelPollHandle` tracks the currently-active panel-detail timer:
  - `openPanelDetail()` clears any prior `panelPollHandle`, dispatches the new render, and (for inbox/trollbox) starts a fresh interval
  - `closePanelDetail()` clears `panelPollHandle`
- Inbox panel polls `/r/:token/inbox` every 5s while open
- Trollbox panel polls `/r/:token/trollbox` every 3s while open (chat is more lively)
- All polling stops on `showDisconnected()`

### 5. DOM additions (concrete)

`index.html` `#workshop-panels` body — add two buttons:

```html
<button class="panel-item" data-panel="inbox">
  <span class="panel-icon">📬</span>
  <span class="panel-label">Inbox</span>
  <span class="panel-unread-pill" id="panels-menu-inbox-pill"></span>
</button>
<button class="panel-item" data-panel="trollbox">
  <span class="panel-icon">💬</span>
  <span class="panel-label">Trollbox</span>
</button>
```

Workshop button + panels button gain a `<span class="unread-pill" id="...-unread-pill"></span>` child.

`app.js` `openPanelDetail()` extends with:

```js
} else if (panelType.includes('inbox')) {
  renderPanelInbox(content)
  panelPollHandle = setInterval(() => renderPanelInbox(content), 5000)
} else if (panelType.includes('trollbox')) {
  renderPanelTrollbox(content)
  panelPollHandle = setInterval(() => renderPanelTrollbox(content), 3000)
}
```

## Decision Log

| Decision | Choice | Reason |
|---|---|---|
| Inbox / proposals shape | Unified inbox (Option A) | Matches 3DS; backend already encodes proposals as inbox messages |
| Trollbox interaction | Read-only (Option C) | No nick storage problem; no spam concerns; lurking is enough |
| Unread badge surfaces | Workshop btn (main view) **and** Panels btn (workshop view) | Most aggressive surfacing — proposals are CEO-grade attention |
| Reject feedback | Optional inline input (Option B) | Keeps fast path fast; preserves the "tell the orchestrator why" flow |
| Code shape | Extend existing `openPanelDetail()` dispatcher (Approach 1) | Both views are list-shaped; promote to dedicated overlays only if they grow rich UI |

## Risks / Open Questions

- **`/inbox/read-all`** doesn't exist on `remote-server.ts` (only on the hub). Plan: client-side loop over visible unread ids. If the unread list ever exceeds ~50 we should add the bulk endpoint, but that's not the case today.
- **Proposal status drift** — if the desktop user approves/rejects a proposal between mobile poll cycles, the mobile card may briefly show stale buttons. Mitigation: server returns the up-to-date `proposalStatus` on every poll; render disabled "Already approved/rejected" buttons when status ≠ `pending`.
- **Trollbox throughput** — 3s polling at the message body size is fine for the size of the user's crew (low single digits to maybe 20 people). If trollbox ever scales up, switch to long-poll or SSE; out of scope here.

## Test Plan

Manual on-device:
1. Open mobile remote view; have desktop orchestrator post `notify_user("hi","high")` → main-view workshop button shows red pill `[1]`
2. Enter workshop, open Panels → "📬 Inbox [1]" → tap → see message; tap card → unread strip drops, badge clears
3. From desktop, propose a 2-agent team via MCP `propose_team` → mobile inbox shows proposal card with Approve/Reject
4. Approve from mobile → desktop spawns the team, mobile card shows "Spawned 2 agents"
5. Propose another, Reject with feedback "not now" → desktop sees a system message with the feedback
6. Open Panels → "💬 Trollbox" → see chat lines updating live as desktop sends; verify no input bar
7. Scroll up in trollbox → wait for new message → confirm view does NOT auto-scroll
8. Disconnect remote → verify polling stops cleanly

Automated:
- Unit test the new render functions with a mocked DOM and fixture state (matches existing `useTrollboxStyle.test.ts` pattern level of effort — small)
