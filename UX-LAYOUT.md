# Control Centre UX — quiet model (2026-09-10)

Donatas will not babysit. He only **OK’s copy** and **OK’s ads**. Everything else is board truth + CoS work.

## Quiet rules

1. **Lots of whitespace**, few labels, hide empty sections.
2. **One clear primary action** in the task modal (`OK copy` / `OK ads`).
3. **Minimal pipeline chrome**: small step dots only on creative cards (and matching dots in the modal). No board-level pipeline strip. No “Where this is” labeled flow.
4. Soften jargon in UI: **ad images**, **OK copy**, **OK ads**. Avoid CoS / locked / QC / gates in what he sees.
5. **Needs you** = only `approve_copy` and `approve_statics`.

## My plate (Home)

Personal board of everything (ops, clients, ventures).

- Kanban: **Inbox / In progress / Waiting on you / Done**
- Thin overview only when there is something to show (Needs you count, open work, ad work)
- **Needs you** strip (`data-marker="needs-you"`) when approve_* tasks exist
- Card delete kept (✕ + modal Delete)
- Client left rail stays

## Per client (left rail)

Same four columns, filtered. Chat + Delegate stay.

## Truth only (product LOCKED)

| Surface | Rule |
|---------|------|
| Drive row | Show **only** when `driveUrl` is a real `https://drive.google.com/...` link |
| Ad images gallery | Show **only** when `images[].length > 0` (after stripping sample-ad) |
| Stage `drive_upload` / `done` | Forbidden without real images **and** real Drive URL |
| Progress “uploading” | Same — server rejects PATCH that violates this |
| sample-ad.jpg | Never seeded onto tasks; not shown as real work |

Server enforces via `truthViolation()` on POST/PATCH and `scrubLyingTasks()` on boot. Fake Drive URLs are sanitized to empty. Deleted tasks are **never** resurrected (`lockedPtSeeded` once → no reseed).

## Stage → Kanban

| Stage (API) | Column | Header |
|-------------|--------|--------|
| `research` | inbox | Inbox |
| `copywriting`, `static_production`, `drive_upload` | cooking | In progress |
| `approve_copy`, `approve_statics` | waiting | Waiting on you |
| `done` | done | Done |

## Plain language (UI)

| Stage | Card / modal | Short |
|-------|--------------|-------|
| `research` | In the inbox | Inbox |
| `copywriting` | Writing copy | Writing |
| `approve_copy` | Needs your OK on copy | OK copy |
| `static_production` | Making ad images | Ad images |
| `approve_statics` | Needs your OK on ads | OK ads |
| `drive_upload` | Uploading | Upload |
| `done` | Done | Done |

### Big actions (modal)

| When | Primary (`data-marker`) | Secondary |
|------|-------------------------|-----------|
| `approve_copy` | **OK copy** (`ok-copy`) → `static_production` | Send back to writing |
| `approve_statics` | **OK ads** (`ok-ads`) → `drive_upload` only if real images + real Drive | Send back to image work |

Path in plain words: **write copy → OK copy → make ad images → OK ads → upload → done**.

## Chat

- POST `/api/chat` stores the user message + status: “Sent — waiting for a reply” (not a fake answer)
- Real answers: POST `/api/chat/reply`
- Poll: GET `/api/chat/pending`

## Creative card heuristic

`clientId === 'ad-factory'` **or** stage in  
`copywriting`, `approve_copy`, `static_production`, `approve_statics`, `drive_upload`.

## Files

- `public/index.html` — Kanban + quiet Needs you + modal
- `public/app.js` — truth helpers, OK copy / OK ads, hide empty Drive/gallery
- `public/styles.css` — quiet ClickUp/Asana spacing
- `server.js` — truth guards, scrub, no-resurrection seed
- `PIPELINE-CHANGE.md` — API history; this file is the UX source of truth
