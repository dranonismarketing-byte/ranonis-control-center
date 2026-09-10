# Pipeline field + approve flow (Control Centre)

> **UX note (2026-09-10):** Pipeline is **not** the Home board. See `UX-LAYOUT.md`.
> Home / clients use Inbox · Cooking · Waiting on you · Done. Pipeline viz lives in creative card detail and under Ad factory only.

## What the pipeline work added (kept)

### Kept from earlier redesign
- Client left-rail + filter
- Chat panel (CoS / delegate)
- Delegate flow
- Light ClickUp/Asana-style UI
- Auth (session cookie, `X-Control-Token`, localhost)
- Card delete (`DELETE /api/tasks/:id`)

### Pipeline stages (on task `stage` field)
1. `research`
2. `copywriting`
3. `approve_copy` (human)
4. `static_production`
5. `approve_statics` (human)
6. `drive_upload` (stub — no real Drive API)
7. `done`

### Approve / reject (modal, creative / approve_* only)
| Current stage     | Approve →            | Reject →              |
|-------------------|----------------------|-----------------------|
| `approve_copy`    | `static_production`  | `copywriting`         |
| `approve_statics` | `drive_upload`       | `static_production`   |

### Data / migration
- Field: `stage` on each task
- Normalize on read / boot
- Legacy `status` written via soft reverse map for Kanban columns
- `PATCH /api/tasks/:id` accepts `stage` (and legacy `status`)
- Flag `migratedPipeline` in `data/tasks.json`

### Stage → Kanban column (Home / client)
| Stage | Column |
|-------|--------|
| research | inbox |
| copywriting, static_production, drive_upload | cooking |
| approve_copy, approve_statics | waiting |
| done | done |

## How to test locally

```bash
cd /workspace/ranonis-control-center
CONTROL_CENTRE_PASSWORD=test CONTROL_CENTRE_TOKEN=test-token PORT=3080 node server.js
```

### UI smoke
1. Open `/control-centre/`, sign in
2. Home shows **four Kanban columns** (not pipeline-as-board)
3. Overview strip on Home; Needs you when approve_* exist
4. Ad factory shows optional pipeline strip above its Kanban
5. Open creative / approve_* card → pipeline in modal; Approve / Reject / Delete work

### API smoke
```bash
curl -s http://127.0.0.1:3080/control-centre/api/health | jq .
curl -s http://127.0.0.1:3080/control-centre/api/tasks -H 'X-Control-Token: test-token' | jq '.tasks[0] | {stage,status}'
```

## Deploy note
Do **not** push or redeploy from this change set alone unless explicitly asked.
