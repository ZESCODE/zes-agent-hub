# zes-agent-hub

**Agent orchestration hub for zes-workspaces — powered by Pollinations API Gateway, and Vercel + Cloudflare.**

`zes-agent-hub` turns a zes-workspace into an autonomous agent environment with named agent seats, council orchestration, multi-provider model routing, and a full generation-to-deployment pipeline.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Pollinations](https://img.shields.io/badge/Powered%20by-Pollinations-blue)](https://pollinations.ai)
[![Cloudflare](https://img.shields.io/badge/Deploy%20Target-Cloudflare%20Pages-orange)](https://pages.cloudflare.com)

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Seat Configuration](#-seat-configuration-nicknamemodel)
- [Architecture](#-architecture)
- [Pipelines](#-pipelines)
  - [Pipeline 1: Free Tier (Kimi Template + Cloudflare + QC Council)](#-pipeline-1-free-tier-template--cloudflare--qc-council)
  - [Pipeline 2: Vercel + Cloudflare (Premium)](#-pipeline-2-vercel--cloudflare-premium)
  - [Pipeline 3: Auto-Blog (Planned)](#-pipeline-3-auto-blog-planned)
- [QC Council](#-qc-council)
- [Quick Start](#-quick-start)
- [Environment Variables](#-environment-variables)
- [File Structure](#-file-structure)
- [Deployment Commands](#-deployment-commands)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 🧭 Overview

`zes-agent-hub` is the orchestration layer that sits between your users and the AI + infrastructure stack. It:

1. **Routes prompts** through a council of named agent seats (Castor orchestrator + 4 council members).
2. **Generates images** via Pollinations Image API.
3. **Runs a QC Council** (parallel vision model inspection with self-healing retry loop).
4. **Generates content** via Pollinations Text API.
5. **Injects data** into a derived HTML template.
6. **Deploys** the final site to Cloudflare Pages (free tier) or Vercel (paid tier).
7. **(Planned)** Schedules recurring auto-blog posts via Cloudflare Cron Triggers + D1 + R2.

The hub is designed to be **fork-and-rebrand** friendly. Every template, model, and deployment target is configurable without touching the core orchestration logic.

---

## 🪑 Seat Configuration (nickname@model)

The council is composed of an orchestrator and four council seats, each assigned a model and provider.

| Seat | Role | Model Assignment | Provider |
|------|------|-----------------|----------|
| `castor` | Orchestrator | `castor@deepseek-v4.1-flash` | Pollinations |
| `john` | Council | `john@gpt-6-astra` | Pollinations / Kilo |
| `siti` | Council | `siti@claude-opus-5.5` | Pollinations / Kilo |
| `laurent` | Council | `laurent@grok-4.7` | Pollinations / Kilo |
| `labu` | Council | `labu@deepseek-v4.1-flash` | Pollinations |

Seat definitions live in [`seats/config.json`](./seats/config.json). Each seat can be overridden via environment variables (`SEAT_CASTOR_MODEL`, `SEAT_JOHN_MODEL`, etc.) without editing code.

---

## 🏗 Architecture

### Council Orchestration Flow

```mermaid
flowchart TD
    A([User Prompt]) --> B[castor@deepseek-v4.1-flash\nOrchestrator]
    B -->|Route to Council| C[Council Channel]
    C --> D1[john@gpt-6-astra]
    C --> D2[siti@claude-opus-5.5]
    C --> D3[laurent@grok-4.7]
    C --> D4[labu@deepseek-v4.1-flash]
    D1 --> E[Consensus & Decision]
    D2 --> E
    D3 --> E
    D4 --> E
    E --> F[Pollinations Gateway]
    F --> G[Vercel + Cloudflare Deploy]