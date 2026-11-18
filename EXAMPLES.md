# zes-agent-hub — Example Usage

All commands assume the repository root and Node.js 20 or newer:

```bash
npm install
cp .env.example .env    # then fill in POLLINATIONS_API_KEY and deploy credentials
```

The council scripts need a valid `POLLINATIONS_API_KEY`; with a dummy key the first
request hangs. See [Troubleshooting](./README.md#troubleshooting).

## 1. Start the Hub

```bash
npm run start
curl http://localhost:8765/healthz
```

## 2. Basic Council Run

Test council orchestration with a single prompt:

```bash
export POLLINATIONS_API_KEY=your_key_here
npm run agent:council -- "Build and deploy a website on Vercel + Cloudflare"
```

The runner asks Castor to route the prompt, sends it to the council seats, synthesizes a
plan and prints the deployment stages. It does not deploy anything itself.

## 3. Drive Loop (Unattended Mode)

```bash
npm run agent:drive
```

Polls the member seats (john, siti, laurent, labu) every
`DRIVE_LOOP_INTERVAL_MS` (default 30 seconds) for inbox messages.

## 4. Seat Setup

```bash
npm run agent:setup
```

Registers the seats, missions and delegations from `seats/config.json` on the hub.

## 5. Deploy Pipeline

```bash
# Clone/pull the template, then deploy to Vercel and Cloudflare
node scripts/deploy-pipeline.js

# Or deploy the current project directly
npm run deploy:vercel
npm run deploy:cloudflare
npm run deploy:all
```

`scripts/deploy-pipeline.js` uses `ZES_CODES_PATH` for the local template clone
(default `/data/data/com.termux/files/home/tmp/vercel/zes.codes`).

## 6. HTTP API

Check hub health:

```bash
curl http://localhost:8765/healthz
```

List seats:

```bash
curl http://localhost:8765/api/agora/seats
```

Get pipeline status:

```bash
curl http://localhost:8765/api/agora/pipeline-status
```

Post a message to the council channel:

```bash
curl -X POST http://localhost:8765/api/agora/post \
  -H "Content-Type: application/json" \
  -d '{"channel":"council-channel","message":"Review this deployment","from":"castor"}'
```

Get a seat inbox:

```bash
curl http://localhost:8765/api/agora/inbox/john
```

## 7. Seat Reference

| Seat | Nickname@Model | Role | Capabilities |
| --- | --- | --- | --- |
| castor | castor@deepseek/deepseek-v4.1-flash | Orchestrator | routing, synthesis, task-delegation, result-aggregation, vercel-deploy, cloudflare-deploy |
| john | john@openai/gpt-6-astra | Council | strategy, architecture, decision-making, planning |
| siti | siti@openai/gpt-6.1-terra | Council | creative, content, ux-design, writing |
| laurent | laurent@x-ai/grok-4.6 | Council | implementation, code-review, system-design, debugging |
| labu | labu@deepseek/deepseek-v4.1-flash | Council | deployment, infrastructure, vercel, cloudflare, devops |

## 8. Docker

```bash
docker compose up -d
```

The container expects `.env` and exposes ports 8765 (hub) and 5173 (frontend).

## 9. Vercel Deployment

```bash
npm run deploy:vercel
```

Set these variables in the Vercel project:

- `POLLINATIONS_API_KEY`
- `KILO_API_KEY` (optional)
- `AGORA_HUB_ADMIN_KEY`
- `VERCEL_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`vercel.json` routes `/healthz` and `/api/agora/*` to `server/index.js`.

## 10. Template Reference

- **ZES.codes** template: https://zes.codes
- **Local template**: set `ZES_CODES_PATH` (default
  `/data/data/com.termux/files/home/tmp/vercel/zes.codes`)
