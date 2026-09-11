# Operating note — Hermes static bakeoff (Control Centre)

## What happens on OK copy

1. Donatas hits **OK copy** on a Waiting card (`approve_copy`).
2. Card moves to **Cooking** (`static_production`) with honest progress: Hermes bakeoff queued/running.
3. Control Centre enqueues **Hermes kanban** tasks — **not** Web GPT / CoS ChatGPT browser.

## Bakeoff assignees (default MVP)

Always create **one task per assignee** when statics are requested after approve:

| Assignee | Role |
|----------|------|
| `don-draper` | Control |
| `blade` | Challenger |
| `press` | Challenger |
| `scout` | Challenger |
| `mixer` | Challenger |
| `arena` | Challenger |

Skill: `meta-static-ad-production`  
Mode flag: `hermesMode=bakeoff` (default). Future `production` = `don-draper` only.

Documented in code: `hermesStatic.js` header comment.

## Task body includes

- Client slug
- Locked on-image lines (exact)
- Product truth
- Dual swipe URLs: `https://ads.nik.co/` + `https://ranonisandpartners.com/team/swipe/`
- Output path under `/opt/data/outputs/<client>/cc-<id>-<date>/`
- Drive upload if possible; **never invent** Drive links
- Do not call work “approved”
- Return **MEDIA** absolute path(s)

## Card fields (honest)

- `hermes_task_ids` — real Hermes ids
- `hermesStatus` — `pending_enqueue` → `dispatched` / `running` → `complete` (or `enqueue_failed` / `blocked`)
- `hermesLocalOutputs` — paths scraped from Hermes results when present
- **No** auto-jump to Waiting / `approve_statics` — CoS QC does that (quiet-to-CoS)

## Dispatch plumbing

- CC API marks `pending_enqueue` on approve (and tries in-process docker-exec if sock available).
- Compose sidecar **`hermes-bridge`** (same project) drains pending via `docker exec` into `hermes-agent-57r8-hermes-agent-1`, then polls `hermes kanban show`.
- Manual retry: `POST /control-centre/api/tasks/:id/hermes-enqueue` with `X-Control-Token`
- Poll: `POST /control-centre/api/hermes/poll`
- Assignees doc: `GET /control-centre/api/hermes/bakeoff-assignees`

## Out of scope

- FPRO
- Fake board state / placeholder Drive links
- Resurrecting deleted cards
