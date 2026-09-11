# Ranonis Control Centre

Thin ops board for Donatas: chat with the Chief of Staff, delegate work, watch **Cooking**, read **Results**.

Serves under **`/control-centre`** on `ranonisandpartners.com` (path prefix).  
**New Docker project only** — never merge into existing Hostinger compose stacks.

## Features (MVP)

1. **Chat with CoS** — message list + compose; stored in `data/chat.json`
2. **Delegate** — title, brief, priority → task `status=queued` in `data/tasks.json`
3. **Cooking** — `queued` and `in_progress`
4. **Results** — `done` with result text/links
5. Password gate (`CONTROL_CENTRE_PASSWORD`)
6. CoS sync API via session cookie, `X-Control-Token`, or localhost

Seeded with two **example** Possible Training ad-factory pilot results (marked `example`).

## Local run

```bash
cd /workspace/ranonis-control-center
npm install
CONTROL_CENTRE_PASSWORD=change-me CONTROL_CENTRE_TOKEN=change-me-token npm start
```

Open: http://localhost:3080/control-centre/  
Health: http://localhost:3080/control-centre/api/health

Default password: `change-me`

## Docker

```bash
cd /workspace/ranonis-control-center
export CONTROL_CENTRE_PASSWORD='your-strong-password'
export CONTROL_CENTRE_TOKEN='your-cos-token'
docker compose config   # validate
docker compose up -d --build
```

Compose project name is locked to **`ranonis-control-center`**.

## How `/control-centre` works

- Express mounts the whole app at `BASE_PATH` (default `/control-centre`).
- Static assets and APIs are under that prefix (`/control-centre/api/...`).
- Reverse proxy must **forward** the path, **not strip** it.
- Traefik labels in `docker-compose.yml` use  
  `Host(ranonisandpartners.com) && PathPrefix(/control-centre)`.
- nginx sketch:

```nginx
location /control-centre/ {
  proxy_pass http://127.0.0.1:3080;  # keep URI path
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3080` | Listen port |
| `BASE_PATH` | `/control-centre` | URL prefix |
| `CONTROL_CENTRE_PASSWORD` | `change-me` | UI login |
| `CONTROL_CENTRE_TOKEN` | `change-me-token` | `X-Control-Token` for CoS/API |
| `DATA_DIR` | `./data` | Persist chat + tasks |

## API (CoS sync)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/control-centre/api/health` | Public |
| POST | `/control-centre/api/login` | `{ "password" }` → session cookie |
| GET | `/control-centre/api/chat` | Messages |
| POST | `/control-centre/api/chat` | User message (UI session) |
| POST | `/control-centre/api/chat/reply` | CoS reply (token/localhost/session) |
| GET | `/control-centre/api/tasks` | Optional `?status=queued,in_progress` |
| POST | `/control-centre/api/tasks` | Delegate (UI session) |
| PATCH | `/control-centre/api/tasks/:id` | Update status/result |

Auth for sync endpoints: UI cookie, **or** header `X-Control-Token: <CONTROL_CENTRE_TOKEN>`, **or** localhost (no header).

Example CoS reply:

```bash
curl -s -X POST http://127.0.0.1:3080/control-centre/api/chat/reply \
  -H 'Content-Type: application/json' \
  -H 'X-Control-Token: change-me-token' \
  -d '{"text":"Got it. Queued under Cooking."}'
```

## Out of scope / Hostinger note

- Do **not** touch existing Docker projects on the VPS.
- Deploy as a **new** project named `ranonis-control-center`.
- Chat is a polled queue, not live Grok streaming.

## Hermes static bakeoff (after OK copy)

On **OK copy**, cards enter `static_production` and enqueue Hermes kanban bakeoff tasks
(`don-draper` + `blade`/`press`/`scout`/`mixer`/`arena`) via skill `meta-static-ad-production`.
See **OPERATING-HERMES.md**. Not Web GPT.

Compose includes sidecar `hermes-bridge` (docker.sock → Hermes container). Same project only.

