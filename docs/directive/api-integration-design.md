# Phase 2 Task D — Builder and Hub API Integration Design

Assessment date: 2026-11-21
Scope: how the builder creates, publishes and runs workflows through the hub, and how it subscribes
to authorised execution events. The hub API already exists for everything except the event stream
and the export; this document specifies the intended target state.

## 1. Topology and trust boundaries

```
Browser (ZESCODE app)
  |  same-origin fetch, session cookie, Whop access gate
  v
Builder server (React Router server routes, Cloudflare Workers)
  |  Authorization: Bearer <AGORA_HUB_ADMIN_KEY>, server-side only
  v
Hub (zes-agent-hub, Render)
  |  Postgres: jobs, tasks, events, artifacts, approvals, workflow definitions, workflow runs
  v
Postgres
```

Rules that follow from the diagram:

1. The browser never calls the hub directly and never sees the admin key.
2. The builder never writes to the database; every write goes through a hub endpoint.
3. The hub is the only component that executes a workflow.

## 2. Existing request map

| Builder route | Method | Hub endpoint | Auth on the builder | Notes |
| --- | --- | --- | --- | --- |
| `/api/zap/workflows` | GET | `GET /api/v1/workflows` | Whop | Workflow list with the latest version |
| `/api/zap/workflows` | POST | `POST /api/v1/workflows` | Whop | Creates a draft version |
| `/api/zap/workflows/:workflowId` | GET | `GET /api/v1/workflows/:workflowId` | Whop | One workflow with its versions |
| `/api/zap/workflows/:workflowId` | PUT | `PUT /api/v1/workflows/:workflowId` | Whop | Creates a new draft version |
| `/api/zap/workflows/:workflowId` | DELETE | `DELETE /api/v1/workflows/:workflowId` | Whop | Deletes every version of a workflow |
| `/api/zap/workflows/:workflowId/versions` | GET | `GET /api/v1/workflows/:workflowId/versions` | Whop | Version history |
| `/api/zap/workflows/:workflowId/publish` | POST | `POST /api/v1/workflows/:workflowId/publish` | Whop | Publishes a specific version |
| `/api/zap/node-types` | GET | `GET /api/v1/node-types` | Whop | Node catalogue, extended with field descriptors in Phase 2 |
| `/api/zap/jobs` | GET | `GET /api/v1/jobs` | Whop | Job list |
| `/api/zap/jobs` | POST | `POST /api/v1/jobs` | Whop | Creates a job, optionally attaching a workflow version |
| `/api/zap/jobs/:jobId` | GET | `GET /api/v1/jobs/:jobId` | Whop | Job detail |
| `/api/zap/jobs/:jobId/tasks` | GET | `GET /api/v1/jobs/:jobId/tasks` | Whop | Task list |
| `/api/zap/jobs/:jobId/artifacts` | GET | `GET /api/v1/jobs/:jobId/artifacts` | Whop | Artifacts |
| `/api/zap/jobs/:jobId/events` | GET | `GET /api/v1/jobs/:jobId/events` | Whop | Event polling with an `after` cursor, the fallback path |
| `/api/zap/jobs/:jobId/graph` | GET | `GET /api/v1/jobs/:jobId/graph` | Whop | The pinned graph snapshot of the job |
| `/api/zap/jobs/:jobId/run` | POST | `POST /api/v1/jobs/:jobId/run-next` | Whop | Claims and runs the next task |
| `/api/zap/jobs/:jobId/control` | POST | `POST /api/v1/jobs/:jobId/cancel`, `/resume`, `/pause` | Whop | Job control |
| `/api/zap/approvals` | GET | `GET /api/v1/approvals` | Whop | Pending approvals |
| `/api/zap/approvals/:approvalId` | POST | `POST /api/v1/approvals/:id/approve`, `/reject` | Whop | Approval decisions |

All hub calls are made from `app/lib/hub.server.ts`, which adds the bearer token and never returns
it to the browser.

## 3. Write path

### 3.1 Draft, publish, run

```
canvas save     POST /api/v1/workflows         (or PUT for an existing workflow)
                -> hub validates, stores a new draft version
publish         POST /api/v1/workflows/:id/publish { version }
                -> hub marks the version published; published versions are immutable
create job      POST /api/v1/jobs { title, objective, workflowId, workflowVersion }
                -> hub creates the job and pins the definition as graph_snapshot
run             POST /api/v1/jobs/:jobId/run-next
                -> hub claims the next task under a lease and executes it
```

The job response already reports the attached workflow and the contract version:

```json
{
  "jobId": "a963ca68-b9ca-4716-8b1a-a80e52293bd1",
  "status": "requested",
  "workflowType": "scout_fork_build_sell",
  "workflow": {
    "workflowId": "scout-zescode-zes-builder",
    "version": 2,
    "contractVersion": "zes.workflow/v1"
  },
  "createdAt": "2026-11-21T12:00:00.000Z"
}
```

### 3.2 Concurrency and idempotency

| Situation | Hub behaviour | Builder behaviour |
| --- | --- | --- |
| Two saves of the same draft | Each `PUT` creates a new version; the hub keeps the history | The canvas keeps the version returned by the last save and warns when the version moved underneath it |
| Publish of an already published version | Rejected, the stored status is not `draft` | The publish button stays disabled for a published version |
| Run requested twice | The lease makes the second claim a no-op while a task is running | The run button is disabled while a run is in flight |
| A job is created with an unknown workflow version | The job is removed and the request fails with 400 | The launcher surfaces the error and does not start a run |
| A protected action reaches its tool | The hub blocks the task and requests an approval | The approval appears in the approvals list and in the job timeline |

## 4. Event subscription (new)

### 4.1 Hub endpoint

```
GET /api/v1/jobs/:jobId/events/stream?after=<eventId>&heartbeat=15000
Authorization: Bearer <AGORA_HUB_ADMIN_KEY>
Accept: text/event-stream
```

Response headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Frame format, using the server-sent events convention:

```
id: <eventId>
event: job.event
data: {"id":"<eventId>","jobId":"<jobId>","type":"task.completed","createdAt":"...","payload":{...}}

: heartbeat
```

Rules:

1. The stream replays the events after the `after` cursor in creation order, then tails new events.
2. The client cursor is the last event id it received. A reconnect sends it back as `after`.
3. A heartbeat comment is sent every 15 seconds by default, so idle connections are not closed by an
   intermediary.
4. The stream closes when the job reaches a terminal state (`completed`, `failed`, `cancelled`).
5. A single connection is limited to 30 minutes and to one job. The client reconnects with the
   cursor if the connection drops.
6. The stream is authorised exactly like every other hub route, with the admin key, and only the
   builder holds that key. Job ownership is enforced before the stream opens, exactly as it is for
   the REST routes.
7. The hub's existing `/ws` Agora socket is not used. It is unscoped and unauthenticated, and
   repurposing it would leak seat messages and workflow events to any client that connects.

### 4.2 Builder proxy

```
GET /api/zap/jobs/:jobId/stream?after=<eventId>
```

The builder route:

1. Checks the Whop session with `requireAccess`.
2. Opens a server-side fetch to the hub stream with the admin key.
3. Pipes the hub frames to the browser unchanged, adding the browser-side `id` so `EventSource`
   reconnects with the right cursor.
4. Closes the upstream connection when the browser disconnects.

The admin key never appears in the browser URL, in a query parameter or in a response header.

### 4.3 Browser client

```ts
const stream = useJobStream(jobId);
```

Behaviour:

1. On mount, the hook opens an `EventSource` on the builder stream route.
2. It applies each event to the local task, artifact and event lists, replacing the poll-based
   refresh.
3. On an error it closes the source, waits with exponential backoff and reconnects with the last
   event id.
4. If the stream is unavailable after three attempts, the hook falls back to the existing polling
   endpoint with the same cursor, so the run view keeps working.
5. The hook stops on a terminal job state.

### 4.4 Event types the run view consumes

| Event | Effect in the builder |
| --- | --- |
| `job.created`, `job.status_changed` | Update the job header |
| `task.created`, `task.started`, `task.completed`, `task.failed`, `task.blocked` | Update the timeline entry for the node |
| `task.skipped` | Mark the branch not taken |
| `approval.requested`, `approval.decided` | Update the approvals panel |
| `artifact.created` | Add the artifact to the artifact list |
| `tool.permission_denied` | Surface the permission denial on the node |

## 5. Error semantics

| Status | Meaning | Builder behaviour |
| --- | --- | --- |
| 400 | The request body is invalid or the workflow version cannot be attached | Show the validation detail |
| 401 | The hub rejected the admin key | Log the hub error, fail closed, alert the operator |
| 403 | The Whop session has no access | Return the access gate response |
| 404 | The job or workflow does not exist | Show an empty state rather than an error toast |
| 409 | A version conflict, for example publishing an already published version | Ask the user to reload the latest version |
| 422 | The definition failed contract validation | Show the issue list with the paths the hub returned |
| 429 | The hub rate-limited the request | Back off and retry with jitter |
| 502 | The builder could not reach the hub | Retry, then fall back to polling |
| 503 | The hub is not configured in the builder | Show a configuration error, do not retry |

## 6. Observability

- Every hub request carries a request id that is returned in the `X-Request-Id` header and logged.
- The stream logs its connection count, the number of frames sent and the disconnect reason.
- The builder logs stream attempts, reconnects and fallbacks with the job id.
- The hub's job event log remains the durable record; the stream is only a delivery mechanism.

## 7. Out of scope

| Item | Reason |
| --- | --- |
| Browser to hub direct calls | Would expose the admin key and remove the Whop gate |
| Repurposing the Agora `/ws` socket | Unauthenticated and unscoped, it would leak unrelated traffic |
| Moving execution into the builder | The hub owns execution, permissions, budgets and approvals |
| A WebSocket protocol for workflow events | Server-sent events fit the one-way event flow and work with the existing edge proxy |
| A second workflow store in the builder | The builder would drift from the hub and break the single source of truth |
