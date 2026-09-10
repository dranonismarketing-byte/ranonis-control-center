# Control Centre UX layout (locked 2026-09-10)

Donatas disliked pipeline-as-Home. Correct model:

## 1. My plate (Home)

Personal board of **everything** (ops, clients, ventures, random).

- Primary chrome: **Kanban** — Inbox / Cooking / Waiting on you / Done
- Thin **overview** strip above the board: Needs you count, active-by-client, optional creative-stage totals
- **Needs you** strip: approve_* cards (overview, not a replacement board)
- Card delete kept (✕ + modal Delete)
- **No** creative pipeline strip forced on Home

## 2. Per client (left rail)

Same four Kanban columns, filtered to that client. Chat + Delegate stay.

## 3. Creative pipeline (narrow)

Stages still exist on tasks (`stage` field):

`research → copywriting → approve_copy → static_production → approve_statics → drive_upload → done`

Shown **only**:

- Inside a **creative card** detail modal (stage track + compact flow), or
- As a pipeline strip when viewing **Ad factory** client

Not the sole Home board.

## 4. Overview dashboard

Home-only thin top section — load/connections visualization, not a board replacement.

## Column mapping (stage → Kanban)

| Stage | Home / client column |
|-------|----------------------|
| `research` (new drops / inbox) | Inbox |
| `copywriting`, `static_production`, `drive_upload` | Cooking |
| `approve_copy`, `approve_statics` | Waiting on you |
| `done` | Done |

Legacy `status` (`inbox` / `cooking` / `waiting` / `done`) is kept in sync via server reverse map.

## Creative card heuristic

Treated as creative when `clientId === 'ad-factory'` **or** stage is one of:
`copywriting`, `approve_copy`, `static_production`, `approve_statics`, `drive_upload`.

## Files

- `public/index.html` — Kanban columns + optional overview / needs-you / Ad factory pipeline
- `public/app.js` — column mapping, selective pipeline render
- `public/styles.css` — light ClickUp/Asana UI
- `server.js` — `stage` + DELETE API unchanged in role
- `PIPELINE-CHANGE.md` — pipeline API history; this file is the UX source of truth
