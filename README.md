# zes-agent-hub

**Agent orchestration hub for bolt.diy / zes-builder workspaces — powered by AgoraHub, Pollinations API Gateway, and Vercel + Cloudflare.**

`zes-agent-hub` turns a bolt.diy/zes-builder workspace into an autonomous agent environment with named agent seats, council orchestration, and multi-provider model routing.

## Seat Configuration (nickname@model)

| Seat | Role | Model Assignment | Provider |
|------|------|-----------------|----------|
| castor | Orchestrator | castor@deepseek-v4.1-flash | Pollinations |
| john | Council | john@gpt-6-astra | Pollinations/Kilo |
| siti | Council | siti@claude-opus-5.5 | Pollinations/Kilo |
| laurent | Council | laurent@grok-4.7 | Pollinations/Kilo |
| labu | Council | labu@deepseek-v4.1-flash | Pollinations |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Prompt                              │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              castor@deepseek-v4.1-flash (Orchestrator)      │
│         Reads prompt → routes to council channel            │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│           Council Channel (john, siti, laurent, labu)       │
│   john@gpt-6-astra  siti@claude-opus-5.5  laurent@grok-4.7  │
│   labu@deepseek-v4.1-flash                                         │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│   Pollinations Gateway → Vercel + Cloudflare Deploy         │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone
git clone https://github.com/ZESCODE/zes-agent-hub.git
cd zes-agent-hub/agent-hub

# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run council orchestration
pnpm run agent:council "Build and deploy a website on Vercel + Cloudflare"

# Run drive loop (unattended)
pnpm run agent:drive

# Start hub server
pnpm start
```

## Vercel + Cloudflare Pipeline (First Pipeline)

The first pipeline builds and deploys a website using:

1. **Vercel** — Frontend hosting and serverless functions
2. **Cloudflare** — DNS, edge caching, Workers, Pages
3. **zes.codes** — Template reference site

### Deploy

```bash
# Vercel deploy
vercel --prod

# Cloudflare deploy (from agent-hub/)
wrangler deploy
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `POLLINATIONS_API_KEY` | Pollinations API key (from master.env) |
| `KILO_API_KEY` | Kilo gateway API key (fallback models) |
| `VERCEL_API_KEY` | Vercel API key for deployment |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `AGORA_HUB_ADMIN_KEY` | AgoraHub admin key |

## Seats & Missions

See `seats/config.json` for full seat definitions with missions, models, and delegations.

## License

MIT
