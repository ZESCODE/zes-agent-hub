# Phase 2 Task F — Security Review of the Proposed Integration

Assessment date: 2026-11-21
Scope: the security posture of the proposed Phase 2 integration (field descriptors, condition lint,
event stream, export, codegen, interpolation) and of the existing surfaces it touches. This review
covers design and code; it is not a penetration test.

## 1. Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| `AGORA_HUB_ADMIN_KEY` | Hub environment, builder environment | Grants full access to every hub route |
| Tool credentials, for example `GITHUB_TOKEN`, `POLLINATIONS_API_KEY` | Hub environment | Must never reach the browser or an artifact |
| Whop session and access entitlement | Builder cookie, Whop | The only user-level access control in front of the ZAP surface |
| Workflow definitions and their published versions | Hub Postgres | Business logic and, in the case of a rebrand workflow, customer-facing configuration |
| Job outputs, artifacts and tool payloads | Hub Postgres, rendered in the builder | May contain customer data or repository content |
| Model routing and provider configuration | Hub | Determines cost and which provider sees the data |

## 2. Trust boundaries

| Boundary | Crossing | Control |
| --- | --- | --- |
| Browser to builder | Session cookie, JSON bodies | Whop session check in `app/lib/whop.server.ts:130` and `app/lib/whop.server.ts:267` |
| Builder to hub | Bearer admin key over TLS | `app/lib/hub.server.ts:17` and `app/lib/hub.server.ts:33`; hub checks at `server/lib/api/v1.js:27` and `server/index.js:361` |
| Hub to Postgres | Connection string | Environment only, never exposed |
| Hub to model providers | Provider credentials | Hub only, `server/lib/providers/router.js` |
| Hub to external services, for example GitHub | Service tokens | Hub only, `server/lib/tools/registry.js` |

## 3. Threat model

| Adversary | Capability | Main concern |
| --- | --- | --- |
| Unauthenticated visitor | Can reach the builder and the public hub origin | Must not read or change any workflow, job or artefact |
| Authenticated builder user without the product | Has a Whop session | Must not read or change the ZAP surface |
| Authenticated builder user with the product | Has a Whop session with access | Must not escalate to the hub, to another tenant's jobs, or to a credential |
| A compromised builder dependency | Runs inside the builder server bundle | Must not obtain the admin key or long-lived access |
| A malicious workflow author | Can submit a definition to the hub | Must not obtain model identifiers, permissions, credentials or arbitrary code execution |
| A malicious tool payload | Controls repository or web content returned by a tool | Must not execute in the browser or in the hub, and must not leak secrets when rendered |

## 4. Existing controls that were verified

| Control | Evidence | Verdict |
| --- | --- | --- |
| The browser cannot choose a model | The contract rejects `config.model` and `config.permissions` | Effective |
| The browser cannot widen permissions | Tool permissions are checked at run time by `canUse` and denied tasks are audited | Effective |
| The admin key never reaches the browser | It lives in `app/lib/hub.server.ts`, a server-only module, and is only added as an `Authorization` header | Effective |
| Every ZAP route is gated | All `api.zap.*` routes call `requireAccess` | Effective |
| Protected actions need an approval | The contract requires a matching approval requirement for `deployment.publish`, `github.repository.write` and `builder.project.write` | Effective |
| Jobs pin their definition | The workflow run stores `graph_snapshot` | Effective |
| The contract is validated server-side | `validateWorkflowDefinition` runs on every write | Effective |

## 5. Findings

Severity: **High** means a realistic path to credential or tenant compromise, **Medium** means a
meaningful weakening of a control, **Low** means hardening or hygiene.

| Id | Finding | Severity | Evidence | Mitigation | Phase |
| --- | --- | --- | --- | --- | --- |
| F-01 | The hub enables permissive CORS for every origin | Medium | `server/index.js:34` uses `app.use(cors())` with the default `*` origin | Restrict CORS to the builder's origin and to the deployment health checks. The admin key still protects the routes, so this is defence in depth | Phase 2, small change |
| F-02 | The admin key is compared with a non constant-time comparison | Low | `server/lib/api/v1.js:35` and `server/index.js:368` use `token !== configured` | Compare with `crypto.timingSafeEqual` on equal-length buffers | Phase 2, small change |
| F-03 | Job ownership is parameter driven and defaults to a shared owner | High | `server/lib/api/v1.js:118` resolves the owner from `req.query.ownerEmail` and falls back to `owner@zes.codes` | Derive the owner from the Whop user in the builder and send an owner identity the hub can verify, or scope jobs by a per-user owner record. Until then, the ZAP surface is effectively single tenant | Before multi-user rollout |
| F-04 | The builder's Whop gate does not check the request origin | Low | `requireAccess` validates the session only | Add an `Origin` check to state-changing builder routes. Cross-site form posts are already rejected because the routes require a JSON body, but the check makes it explicit | Phase 2, small change |
| F-05 | The Agora `/ws` socket is unauthenticated and broadcasts to every client | High, pre-existing | `server/index.js:32`, `server/index.js:302`, `server/index.js:472` | Authenticate the socket and scope it to a seat or channel. Phase 2 must not reuse this socket for workflow events | Separate change, before the socket carries any sensitive payload |
| F-06 | No rate limiting on the hub or on the builder's ZAP routes | Medium | No rate limiting dependency in either repository | Add a rate limit to the hub's write routes and to the event stream, and a per-user limit on the builder's job creation | Phase 2 for the stream and job creation |
| F-07 | The new event stream is a long-lived connection surface | Medium | Proposed `GET /api/v1/jobs/:jobId/events/stream` | Authenticate with the admin key, scope to one job, enforce ownership, cap the duration, cap the frame rate and the backlog, and send heartbeats | Phase 2 |
| F-08 | The browser must never receive the admin key, including through a stream | High if violated | Proposed builder proxy route | The proxy adds the header server-side. The browser receives only event frames, never a token, and never a query-string credential | Phase 2, enforced by review and tests |
| F-09 | Tool payloads are rendered in the browser and stored as artefacts | Medium | Artefacts include raw tool results | Adopt the template's redaction helpers in the hub before storing an artefact, and render artefact content as text in the builder, never as HTML | Phase 2 |
| F-10 | Interpolated values reach the model prompt and the tool parameters | Medium | `parameters` values and `objective` fields accept `{{node.field}}` | The hub resolves references from the run context only. The builder parses references for display but never substitutes values. Reject references to nodes that are not upstream | Phase 2 |
| F-11 | A condition expression is a potential injection surface | Medium | `server/lib/workflows/conditions.js` evaluates expressions; the builder has a client-side validator | Keep evaluation on the hub only, lint on both sides with the same grammar, and never evaluate in the browser. Do not port the template's browser-side evaluator | Phase 2 |
| F-12 | `config.parameters` accepts an unbounded record | Low | `node-types.js:64` declares `z.record(z.unknown())` | Cap the serialised size and the nesting depth of `parameters`, and reject prototype-polluting keys | Phase 2 |
| F-13 | The exported workflow could leak internal configuration | Low | The new export endpoint renders a stored definition | Export the stored definition only, never the job snapshot, the artefacts or the environment. Include a content hash so the export can be verified | Phase 2 |
| F-14 | Template-derived code could reintroduce a credential path | Medium | The template's plugin steps fetch credentials from its own database | Only port declarative, data-only parts of the template. The ported condition lint must not fetch, evaluate or import anything with side effects. Record every derived file in the attribution document | Phase 2, with review |
| F-15 | The public git history still contains an old provider key | High, pre-existing | Hub commits `d581053`, `8de0cbf`, `0258adc` | Revoke the key at the provider. Purging the history needs explicit approval because it rewrites every branch | Blocked on the owner |
| F-16 | No security headers on the builder or the hub | Low | Neither service sets a content security policy or `X-Content-Type-Options` | Add baseline headers to the builder. The builder already ships `rehype-sanitize` and `dompurify`, which must stay in use for rendered markdown | Phase 3 |

## 6. Rules for the new surfaces

1. The hub publishes metadata, not authority. Field descriptors tell the builder what to render; the
   hub still validates every value it receives.
2. The builder never evaluates an expression, never resolves a reference and never resolves a
   model.
3. The stream carries job events only. It never carries credentials, environment values or seat
   messages.
4. Every new builder route calls `requireAccess` before it touches the hub.
5. Artefacts are stored redacted and rendered as text.
6. Exports contain definitions only.
7. No new dependency is added in Phase 2, so the supply-chain surface does not grow.

## 7. Residual risks that need sign-off

| Risk | Why it remains | Proposed owner decision |
| --- | --- | --- |
| Shared hub credentials across all builder users | The hub authenticates the builder as one principal | Accept for the internal rollout, or implement F-03 before inviting external users |
| The admin key is a bearer token with full scope | Simplicity of the current design | Accept with rotation every 90 days and a deployment-time secret check |
| The provider key in the public history | The key is still valid until revoked | Revoke now; history purge only on explicit approval |
| The Agora socket remains unauthenticated | Out of Phase 2 scope | Schedule as a separate change before it carries any sensitive payload |

## 8. Verification plan

| Check | Method |
| --- | --- |
| No credential reaches the browser | Inspect the builder client bundle for the admin key and for credential names; assert the absence in a test |
| The stream is authorised | Integration test: a request without the key, or with a wrong key, is rejected; a request for a job that does not exist is rejected |
| The stream is scoped | A stream for job A never emits an event for job B |
| Contract enforcement holds | Existing contract tests plus new cases for the rejected `config.model` and `config.permissions` |
| Tool permissions hold | The existing permission tests plus a case for a denied tool inside a published workflow |
| Artefacts are redacted | A unit test that stores a payload containing a token-shaped string and asserts it is masked in the artefact |
| Export contains nothing extra | A test that compares the export with the stored definition field by field |
| The lint layer never evaluates | A test that asserts the lint module has no expression evaluator and no network access |
