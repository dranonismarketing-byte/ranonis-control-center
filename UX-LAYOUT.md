# Control Centre UX layout (2026-09-10)

Donatas disliked pipeline-as-Home. Correct model:

## 1. My plate (Home)

Personal board of **everything** (ops, clients, ventures, random).

- Primary chrome: **Kanban** — Inbox / In progress / Waiting on you / Done
- Thin **overview** strip above the board: Needs you count, open work by client, optional ad-work totals
- **Needs you** strip: cards that need your OK (overview, not a replacement board)
- Card delete kept (✕ + modal Delete)
- **No** ad-steps strip forced on Home

## 2. Per client (left rail)

Same four Kanban columns, filtered to that client. Chat + Delegate stay.

## 3. Ad steps (narrow)

Stages still exist on tasks (`stage` field — **API values unchanged**):

`research → copywriting → approve_copy → static_production → approve_statics → drive_upload → done`

Shown **only**:

- Inside a creative card detail modal (“Where this is” + step dots), or
- As an **Ad steps** strip when viewing **Ad factory** client

Not the sole Home board.

## 4. Overview dashboard

Home-only thin top section. Plain labels only: Needs you · Open work by client · Ad work.

## Column mapping (stage → Kanban)

| Stage (API) | Column key | Header label |
|-------------|------------|--------------|
| `research` | inbox | Inbox |
| `copywriting`, `static_production`, `drive_upload` | cooking | In progress |
| `approve_copy`, `approve_statics` | waiting | Waiting on you |
| `done` | done | Done |

Legacy `status` stays in sync via server reverse map. DOM/API column key `cooking` is unchanged; the header reads **In progress**.

## Plain language map (UI only)

| Stage (API) | Card / modal status | Short strip |
|-------------|---------------------|-------------|
| `research` | In the inbox | Inbox |
| `copywriting` | Writing copy | Writing |
| `approve_copy` | Needs your OK on copy | OK copy |
| `static_production` | Making ad images | Ad images |
| `approve_statics` | Needs your OK on images | OK images |
| `drive_upload` | Uploading | Upload |
| `done` | Done | Done |

### Big actions (modal)

| When | Primary | Secondary |
|------|---------|-----------|
| `approve_copy` | Approve copy → make statics | Send back to writing |
| `approve_statics` | Approve images → upload | Send back to image work |
| `copywriting` / `static_production` with a result | Ready for my review → matching approve_* | — |

Path in plain words: **write copy → your OK → make statics → your OK on images → upload → done**.

## In-app ad review

- Task fields: `images[]` (`{ id, url, status, note }`), plus image-looking `resultLinks`
- Modal **Ad images** gallery: thumbnails; on `approve_statics` / `static_production`, per-image **OK** / **Send back** (must be visible under each thumb)
- Set-level approve/reject buttons still advance the stage

## Google Drive folder

- Task field: `driveUrl`
- Modal shows **Google Drive folder** with open link + Change / Add
- PATCH `/api/tasks/:id` accepts `driveUrl`

## Chat

- POST `/api/chat` stores the user message and a **status** line: “Sent — waiting for a reply” (not a fake answer)
- Real answers: POST `/api/chat/reply` (token / session / localhost) — clears waiting status
- Poll unanswered: GET `/api/chat/pending`
- UI: optimistic send, clear errors, “Sent — waiting for a reply” status (no silent fail)

## Creative card heuristic

`clientId === 'ad-factory'` **or** stage in:
`copywriting`, `approve_copy`, `static_production`, `approve_statics`, `drive_upload`.

## Files

- `public/index.html` — Kanban + overview / needs-you / ad steps + modal gallery / Drive / chat status
- `public/app.js` — plain labels, chat UX, gallery, Drive
- `public/styles.css` — light ClickUp/Asana UI
- `server.js` — stage machine unchanged; chat pending + `images` / `driveUrl`
- `PIPELINE-CHANGE.md` — pipeline API history; this file is the UX source of truth
