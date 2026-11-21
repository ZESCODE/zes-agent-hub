# Phase 2 Task G — Test Plan

Assessment date: 2026-11-21
Scope: the tests that must exist before the Phase 2 integration is considered done. The plan covers
the new components, the changed components and the integration points between the builder and the
hub.

## 1. Objectives

1. Every new behaviour has a test that fails when the behaviour is removed.
2. The contract remains a single, shared artefact: a fixture is validated identically by the hub
   and the builder.
3. The security controls in the security review are regression tested, not only reviewed.
4. The existing production paths, especially the Scout template, keep working unchanged.

## 2. Baseline

| Repository | Command | Current state |
| --- | --- | --- |
| Hub | `node node_modules/vitest/vitest.mjs run` | 108 tests in 13 files pass with `POLLINATIONS_API_KEY` set |
| Hub | `node node_modules/eslint/bin/eslint.js .` | Clean |
| Hub | `node node_modules/typescript/bin/tsc --noEmit` | Clean |
| Builder | `npx --no-install vitest --run` | 97 tests in 8 files pass |
| Builder | `npx --no-install eslint app` | Clean for the files touched; pre-existing failures remain in files outside this scope |
| Builder | `node --max-old-space-size=3072 node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js` | Clean |
| Builder | `VERCEL=1 npx --no-install react-router build` | Green |

Phase 2 must not reduce these numbers and must not add a failure outside the touched files.

## 3. Test layers

| Layer | Location | Runner |
| --- | --- | --- |
| Hub unit | `tests/unit/` | Vitest |
| Hub integration | `tests/integration/` | Vitest with the in-process Postgres harness |
| Builder unit | `tests/unit/` | Vitest |
| Builder component | `tests/unit/` with a DOM environment | Vitest |
| Builder integration | `tests/integration/` | Vitest |
| Contract parity | Both repositories | Vitest, driven by one shared fixture |
| End to end | Manual or scripted against the deployed hub | Acceptance script |

## 4. Hub test cases

### 4.1 Field descriptors, `tests/unit/node-fields.test.js`

| Id | Case | Expected |
| --- | --- | --- |
| H-01 | Every node type in `NODE_TYPES` exposes a non-empty `fields` array | No type is missing a descriptor |
| H-02 | Every descriptor key exists in the node type's zod config schema | No descriptor describes a field the contract rejects |
| H-03 | A descriptor marked `required` corresponds to a schema field that the contract requires | The UI cannot demand less than the contract |
| H-04 | `select` descriptors for `routingPolicy.taskType` list only known hub task types | The palette cannot offer an unknown task type |
| H-05 | `select` descriptors for `toolName` list only known tool names | The palette cannot offer an unknown tool |
| H-06 | `showWhen` references a sibling field | No dangling conditional |
| H-07 | `describeNodeTypes()` stays backward compatible | Existing descriptor fields keep their names and types |

### 4.2 Condition lint, `tests/unit/condition-lint.test.js`

| Id | Case | Expected |
| --- | --- | --- |
| H-10 | A simple comparison against an allowed input | Accepted |
| H-11 | A method call, `foo.bar()` | Rejected with a precise message |
| H-12 | A bracket expression, `foo['bar']` | Rejected |
| H-13 | An unknown identifier | Rejected |
| H-14 | An unbalanced parenthesis | Rejected |
| H-15 | `sanitizeForDisplay` strips control characters | The display is safe to render |
| H-16 | The lint module imports no evaluator and performs no network access | The browser layer cannot evaluate |

### 4.3 Contract changes, `tests/unit/workflow-contract.test.js` (extended)

| Id | Case | Expected |
| --- | --- | --- |
| H-20 | `config.parameters` above the size cap | Rejected with the path of the field |
| H-21 | `config.parameters` with a prototype-polluting key | Rejected |
| H-22 | A condition expression that fails the lint | Rejected with the lint message |
| H-23 | A condition expression that passes the lint | Accepted |
| H-24 | Every previously accepted definition is still accepted | No regression for stored definitions |
| H-25 | Every previously rejected definition is still rejected | No regression for the security rules |

### 4.4 Export, `tests/unit/workflow-export.test.js`

| Id | Case | Expected |
| --- | --- | --- |
| H-30 | JSON export of a stored version | Byte-equivalent to the stored definition |
| H-31 | TypeScript export of a stored version | Parses back to the same object |
| H-32 | Export of an unpublished draft | Works, and the output records the draft status |
| H-33 | Export contains no artefact, environment or job data | Only definition fields are present |

### 4.5 Event stream, `tests/integration/workflow-stream.test.js`

| Id | Case | Expected |
| --- | --- | --- |
| H-40 | Stream request without the admin key | 401 |
| H-41 | Stream request with a wrong key | 401 |
| H-42 | Stream for an unknown job | 404 |
| H-43 | Stream with `after` equal to the last seen event | Only newer events are sent |
| H-44 | Events are delivered in creation order | Ordering is preserved |
| H-45 | The stream sends a heartbeat while the job is idle | A heartbeat frame arrives within the interval |
| H-46 | The stream closes when the job completes | The connection ends after the terminal event |
| H-47 | The stream closes after the maximum duration | The connection ends and the client can reconnect with its cursor |
| H-48 | Two streams for two different jobs | Neither receives the other's events |
| H-49 | A client that disconnects early | The upstream connection is closed and no events accumulate |

### 4.6 Redaction, `tests/unit/redact.test.js`

| Id | Case | Expected |
| --- | --- | --- |
| H-55 | An artefact payload with a token-shaped string | The token is masked in the stored artefact |
| H-56 | An artefact payload with a nested credentials object | The credentials are stripped |
| H-57 | A payload with no secrets | The payload is stored unchanged |

## 5. Builder test cases

### 5.1 Field rendering, `tests/unit/config-fields.test.tsx`

| Id | Case | Expected |
| --- | --- | --- |
| B-01 | A required field | It is marked as required and the form reports it |
| B-02 | A `select` field | The options come from the descriptor |
| B-03 | A `number` field with `min` and `max` | Out-of-range values are rejected before the save |
| B-04 | A `group` field | The nested fields render inside the group |
| B-05 | A `showWhen` condition | The dependent field appears only when the condition holds |
| B-06 | A `json` field | The value round-trips through the store unchanged |
| B-07 | A `template-input` field | The reference is parsed and shown as a dependency, and the raw value is preserved |

### 5.2 Contract mirror, `tests/unit/workflow-contract.test.ts` (extended)

| Id | Case | Expected |
| --- | --- | --- |
| B-10 | `toHubPayload` output on the shared fixture | It equals the fixture definition, field for field |
| B-11 | Acceptance criteria strings | They become `criterion_<n>` objects with the verifier agent |
| B-12 | A definition containing `model` or `permissions` | It is rejected client-side, as the hub would |
| B-13 | A definition with a cycle | It is rejected client-side |
| B-14 | A definition with a condition that fails the lint | The issue is shown in the config panel |

### 5.3 Lint parity, `tests/unit/condition-lint.test.ts`

| Id | Case | Expected |
| --- | --- | --- |
| B-20 | The shared fixture's condition expressions | The builder verdict equals the hub verdict, fixture by fixture |
| B-21 | A lint message | It names the offending expression and the reason |

### 5.4 Codegen, `tests/unit/workflow-codegen.test.ts`

| Id | Case | Expected |
| --- | --- | --- |
| B-30 | JSON export | It equals the stored definition |
| B-31 | TypeScript export | It matches the golden file and parses back to the same object |
| B-32 | A workflow with no edges | The export is still valid |
| B-33 | Node labels with spaces and punctuation | The generated variable names are valid identifiers |

### 5.5 Stream client, `tests/unit/job-stream.test.ts`

| Id | Case | Expected |
| --- | --- | --- |
| B-40 | Events arrive | The task, artifact and event lists update without a manual refresh |
| B-41 | The stream drops | The client reconnects with the last event id |
| B-42 | The stream is unavailable after three attempts | The client falls back to polling with the same cursor |
| B-43 | The job reaches a terminal state | The subscription stops |
| B-44 | An event for another job arrives | It is ignored |

## 6. Contract parity fixture

One file is the source of truth for both repositories:

```
hub:      tests/fixtures/zes.workflow.v1.json
builder:  tests/fixtures/zes.workflow.v1.json
```

The fixture contains a complete workflow with one node of every type, a condition with both
handles, an approval gate, a protected tool action, acceptance criteria, a budget and
interpolated parameters.

Parity rules:

1. The hub test asserts the fixture validates against `validateWorkflowDefinition` without issues.
2. The builder test asserts `toHubPayload` on the fixture produces the same object.
3. Both repositories carry a checksum of the fixture in the test, so an edit on one side without
   the other fails the other side's test.

## 7. Integration and end-to-end checks

| Id | Scenario | Expected |
| --- | --- | --- |
| I-01 | Save a draft from the canvas | The hub stores a new draft version and the canvas shows its number |
| I-02 | Publish that version | The version becomes published and cannot be edited |
| I-03 | Create a job with the published version | The response carries the workflow id, version and contract version |
| I-04 | Run the job | The scheduler executes the graph and the event stream shows each step |
| I-05 | A tool permission is denied | The task is blocked, the audit records `tool.permission_denied` and the stream shows it |
| I-06 | An approval is required | The job waits, the approvals list shows it, the decision resumes the job |
| I-07 | The definition is edited after the job started | The running job keeps its pinned snapshot |
| I-08 | The browser is disconnected for a minute and reconnects | The client receives the missed events in order |
| I-09 | The Scout launcher runs end to end | The existing acceptance path still passes: plan, repository read, research, verification pass, report artefact, job completed |

## 8. Security regression tests

| Id | Check | Method |
| --- | --- | --- |
| S-01 | The admin key is absent from the browser bundle | A build-time assertion over the client output |
| S-02 | The stream rejects a missing or wrong key | Integration test H-40 and H-41 |
| S-03 | The stream does not leak events across jobs | H-48 |
| S-04 | Browser-supplied models and permissions stay rejected | Existing contract tests plus H-24 and H-25 |
| S-05 | Artefacts contain no token-shaped strings | H-55 and H-56 |
| S-06 | The export contains nothing beyond the definition | H-33 |
| S-07 | The lint layer cannot evaluate | H-16 |
| S-08 | Every new builder route is gated | A test that walks the route table and asserts each new route calls `requireAccess` |

## 9. Performance checks

| Id | Check | Target |
| --- | --- | --- |
| P-01 | Event delivery latency after a task completes | Under one second from the hub event to the browser frame |
| P-02 | Stream connection count during a five-task run | One connection, reconnects only on failure |
| P-03 | Canvas render time with 50 nodes and 100 edges | No regression beyond the current baseline |
| P-04 | `GET /api/v1/node-types` with descriptors | Under 300 ms at the 95th percentile |
| P-05 | Export of a 100-node definition | Under one second |

## 10. Execution order and gates

| Gate | Requirement |
| --- | --- |
| Gate 1, descriptors | H-01 to H-07 and B-01 to B-07 pass |
| Gate 2, lint | H-10 to H-16, H-22, H-23, B-14, B-20, B-21 pass |
| Gate 3, stream | H-40 to H-49, B-40 to B-44, I-08 and S-02 to S-03 pass |
| Gate 4, export and redaction | H-30 to H-33, H-55 to H-57, B-30 to B-33, S-05, S-06 pass |
| Gate 5, integration | I-01 to I-09 pass, including the Scout acceptance run on the deployed hub |
| Gate 6, release | Both repositories pass lint, typecheck, the full test suites and the builder build; the hub is redeployed and healthy; the builder is redeployed and `/zap` returns 200 while `/api/zap/node-types` still returns 401 without a session |

## 11. Environments and test data

| Environment | Purpose |
| --- | --- |
| Local hub with the in-process Postgres harness | Unit and integration tests |
| Local builder against the local hub | Proxy and stream behaviour |
| Deployed hub on Render and the deployed builder on Vercel | The I-09 acceptance run and the manual checklist |

Test data rules: no production credentials in a test; the provider key is supplied through the
environment and the tests skip the provider dependent cases when it is absent; no real customer
repository is read in a test, a public fixture repository is used instead.

## 12. Definition of done for Phase 2

1. Every case above is implemented and green.
2. The builder bundle contains no credential and no admin key.
3. The hub and the builder agree on the shared fixture.
4. The Scout acceptance run still passes on the deployed environment.
5. `NOTICE` and the attribution document are in place in both repositories.
6. The security findings F-01, F-02, F-04, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13 and F-14
   are closed or explicitly accepted in writing.
