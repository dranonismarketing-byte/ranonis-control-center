# Pipeline redesign (Control Centre)

## What changed

Replaced the Inbox / Cooking / Waiting / Done Kanban as the primary board with a **creative pipeline** model.

### Kept
- Client left-rail + filter
- Chat panel (CoS / delegate)
- Delegate flow
- Light ClickUp/Asana-style UI (no dark redesign)
- Auth (session cookie, `X-Control-Token`, localhost), clients, chat APIs

### New primary UI
1. **Needs you** strip (top) — only tasks in `approve_copy` or `approve_statics`
2. **Pipeline visualization** — horizontal flow of all stages with live counts
3. **Task list** — each card shows its current pipeline stage (+ delete)

### Pipeline stages (one card moves through these)
1. `research`
2. `copywriting`
3. `approve_copy` (human)
4. `static_production`
5. `approve_statics` (human)
6. `drive_upload` (stub only — no real Drive API)
7. `done`

### Approve / reject (modal)
| Current stage     | Approve →            | Reject →              |
|-------------------|----------------------|-----------------------|
| `approve_copy`    | `static_production`  | `copywriting`         |
| `approve_statics` | `drive_upload`       | `static_production`   |

When a task is in an `approve_*` stage, the modal shows the result/deliverable.

### Delete
- `DELETE /api/tasks/:id` — same auth as other mutations (`requireApiAccess`)
- UI: ✕ on each card + Delete in modal → confirm dialog
- One-by-one only (no bulk)

### Data / migration
- New field: `stage` on each task
- On read / boot: normalize
  - `inbox` / missing / `queued` → `research`
  - `cooking` / `in_progress` → `copywriting`
  - `waiting` → `approve_copy`
  - `done` → `done`
- Legacy `status` is still written as a soft reverse map for older consumers
- `PATCH /api/tasks/:id` accepts `stage` (and still accepts legacy `status`)
- Flag `migratedPipeline` written once into `data/tasks.json`
- No FPRO client added

### Files touched
- `server.js`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `PIPELINE-CHANGE.md` (this file)

## How to test locally

```bash
cd /workspace/ranonis-control-center
CONTROL_CENTRE_PASSWORD=test CONTROL_CENTRE_TOKEN=test-token PORT=3080 node server.js
```

### API smoke
```bash
# Health (includes stages list)
curl -s http://127.0.0.1:3080/control-centre/api/health | jq .

# Create task (defaults to research if no stage; delegate → copywriting)
curl -s -X POST http://127.0.0.1:3080/control-centre/api/tasks \
  -H 'Content-Type: application/json' -H 'X-Control-Token: test-token' \
  -d '{"title":"Pipe test","brief":"Check stages","clientId":"lab","stage":"approve_copy","result":"Draft copy here"}' | jq .

# List (stage normalized)
curl -s http://127.0.0.1:3080/control-centre/api/tasks -H 'X-Control-Token: test-token' | jq '.tasks[].stage'

# Approve copy → static_production
curl -s -X PATCH http://127.0.0.1:3080/control-centre/api/tasks/<ID> \
  -H 'Content-Type: application/json' -H 'X-Control-Token: test-token' \
  -d '{"stage":"static_production"}' | jq .stage

# Delete
curl -s -X DELETE http://127.0.0.1:3080/control-centre/api/tasks/<ID> \
  -H 'X-Control-Token: test-token' | jq .
```

### UI
1. Open `/control-centre/`, sign in
2. Confirm no 4-column Kanban
3. Confirm pipeline strip + Needs you (when any task is in approve_*)
4. Open an approve_* card → see deliverable → Approve / Reject moves stage
5. Delete via card ✕ or modal → confirm dialog

## Deploy note
Do **not** push or redeploy from this change set alone — parent agent pushes with PAT and redeploys Hostinger.
