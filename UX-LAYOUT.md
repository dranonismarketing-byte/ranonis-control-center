# Control Centre UX — quiet model (2026-09-10)

Source: product rules + `CLEAN-UI-BRIEF.md` (Asana / ClickUp / Linear research).

Donatas will not babysit. For ads his only touchpoints are **OK copy** and **OK final ads**. He also **Delegates**.

## Ad spine (visible)

```
Delegate → OK copy → OK final ads
```

API still uses the full stage machine (`research → copywriting → approve_copy → static_production → approve_statics → drive_upload → done`). The UI collapses that to the three-step spine on creative cards and in the task detail. Markers: `data-marker="delegate"`, `ok-copy`, `ok-ads`, `needs-you`.

## Quiet rules

1. **Lots of whitespace**, few labels, hide empty sections and empty board columns.
2. **One primary CTA per state** (`Delegate` / `OK copy` / `OK final ads`). Reject, note, delete live under **More**.
3. **List-first** (Asana / Linear feel). **Board** is an optional lens via the List | Board toggle (saved in `localStorage`).
4. Soften jargon: **ad images**, **OK copy**, **OK final ads**. No CoS / locked / QC / gates in UI.
5. **Needs you** = only `approve_copy` and `approve_statics`.
6. **Proofing inside the task**: copy + ad images side-by-side in the detail dialog when `images[].length > 0`. Not a separate world.

## My plate (Home)

- Default **List** grouped by Inbox / In progress / Waiting on you / Done (empty groups hidden)
- Optional **Board** with the same four columns (empty columns hidden)
- Thin overview only when there is something to show
- **Needs you** strip when approve_* exist
- Card / row delete kept
- Client left rail + chat stay

## Truth only (LOCKED)

| Surface | Rule |
|---------|------|
| Drive row | Show **only** when `driveUrl` is a real `https://drive.google.com/...` link |
| Ad images gallery | Show **only** when `images[].length > 0` (sample-ad stripped) |
| Stage `drive_upload` / `done` | Forbidden without real images **and** real Drive URL |
| Progress “uploading” | Same — server rejects PATCH |
| sample-ad.jpg | Never seeded; not shown as real work |
| Deleted tasks | Never resurrected (`lockedPtSeeded`) |

## Stage → column

| Stage (API) | Column | Header |
|-------------|--------|--------|
| `research` | inbox | Inbox |
| `copywriting`, `static_production`, `drive_upload` | cooking | In progress |
| `approve_copy`, `approve_statics` | waiting | Waiting on you |
| `done` | done | Done |

## Primary actions

| When | Primary | Secondary (More) |
|------|---------|------------------|
| Home / any | **Delegate** | — |
| `approve_copy` | **OK copy** → `static_production` | Send back to writing, note, delete |
| `approve_statics` | **OK final ads** → `drive_upload` only if real images + real Drive | Send back to image work, note, delete |

## Chat

Honest “Sent — waiting for a reply”. No fake CoS ack. Reply via `POST /api/chat/reply`.

## Files

- `public/index.html` — list-first + board lens + proofing dialog
- `public/app.js` — spine, list rows, truth helpers, one CTA
- `public/styles.css` — quiet Asana/Linear spacing
- `server.js` — truth guards + scrub + no-resurrection
- `/workspace/hermes-pt-static-01/CLEAN-UI-BRIEF.md` — research brief
