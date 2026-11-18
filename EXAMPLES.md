# zes-agent-hub — Example Usage

## 1. Basic Council Run

Test the council orchestration with a single prompt:

```bash
# Set up environment
export POLLINATIONS_API_KEY=your_key_here

# Run council orchestration
pnpm run agent:council "Build and deploy a website on Vercel + Cloudflare"
```

## 2. Drive Loop (Unattended Mode)

Run the drive loop for unattended seat polling:

```bash
pnpm run agent:drive
```

This will poll all member seats (john, siti, laurent, labu) every 30 seconds for inbox messages.

## 3. Seat Setup

Initialize all seats on the hub:

```bash
pnpm run agent:setup
```

## 4. Vercel + Cloudflare Deploy Pipeline

First pipeline: build and deploy a website:

```bash
# Deploy everything
pnpm run deploy:all

# Or deploy separately
pnpm run deploy:vercel
pnpm run deploy:cloudflare
```

Or use the pipeline script directly:

```bash
node scripts/deploy-pipeline.js
```

## 5. HTTP API

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

Post a message to council channel:
```bash
curl -X POST http://localhost:8765/api/agora/post \
  -H "Content-Type: application/json" \
  -d '{"channel":"council-channel","message":"Review this deployment","from":"castor"}'
```

Get seat inbox:
```bash
curl http://localhost:8765/api/agora/inbox/john
```

## 6. Seat Reference (nickname@model)

| Seat | Nickname@Model | Role | Capabilities |
|------|---------------|------|-------------|
| castor | castor@deepseek-v4.1-flash | Orchestrator | routing, synthesis, task-delegation, result-aggregation, vercel-deploy, cloudflare-deploy |
| john | john@gpt-6-astra | Council | strategy, architecture, decision-making, planning |
| siti | siti@claude-opus-5.5 | Council | creative, content, ux-design, writing |
| laurent | laurent@grok-4.7 | Council | implementation, code-review, system-design, debugging |
| labu | labu@deepseek-v4.1-flash | Council | deployment, infrastructure, vercel, cloudflare, devops |

## 7. Docker

```bash
docker-compose up -d
```

## 8. Vercel Deployment

```bash
vercel --prod
```

Set environment variables in Vercel dashboard:
- `POLLINATIONS_API_KEY`
- `KILO_API_KEY` (optional)
- `AGORA_HUB_ADMIN_KEY`
- `VERCEL_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 9. Template Reference

- **zes.codes**: https://zes.codes (template website)
- **Local template**: /data/data/com.termux/files/home/tmp/vercel/zes.codes
