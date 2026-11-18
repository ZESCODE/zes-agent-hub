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
  - [Pipeline 1: Free Tier (zes template + Cloudflare + QC Council)](#-pipeline-1-free-tier-template--cloudflare--qc-council)
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
| `john` | Council | `john@gpt-6-astra` | Pollinations / openai |
| `siti` | Council | `siti@claude-opus-5.5` | Pollinations /  |
| `laurent` | Council | `laurent@grok-4.7` | Pollinations / x |
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


## ZES Free-Tier Pipeline Architecture

```mermaid
flowchart TD
    %% User & Frontend
    User([User]) -->|1. Inputs Title & Niche| UI[app.zes.codes\nFrontend UI]
    UI -->|2. Sends Request| Hub[zes-agent-hub\nOrchestrator]

    %% Image Generation & QC Loop
    Hub -->|3. Request Image| PollImg[Pollinations Image API]
    PollImg -->|4. Returns Raw Image| Hub
    
    subgraph QC_Council [QC Council & Self-Healing Loop]
        Hub -->|5. Sends Image for QC| QCAgent[Pollinations Code Agent\nzes-qc-council]
        QCAgent -->|6a. Parallel Call| ModelA[NVIDIA Super VL]
        QCAgent -->|6b. Parallel Call| ModelB[Nemotron Omni 30B]
        ModelA -->|7a. Verdict| QCAgent
        ModelB -->|7b. Verdict| QCAgent
        QCAgent -->|8. Consensus JSON\nPass/Fail| Hub
        
        Hub -- "If FAIL (Max 3 Retries)\nGenerate New Seed" --> PollImg
    end

    %% Success Path & Storage
    Hub -- "If PASS" --> R2[Cloudflare R2\nImage Storage]
    R2 -->|9. Returns Public Image URL| Hub

    %% Text Generation & Assembly
    Hub -->|10. Request Copy| PollText[Pollinations Text API\ngpt-oss-20b]
    PollText -->|11. Returns Hero Copy| Hub
    
    Hub -->|12. Inject Data into HTML| Template[Kimi HTML Template]
    
    %% Deployment
    Hub -->|13. Deploy Final HTML| CFPages[Cloudflare Pages API]
    CFPages -->|14. Returns Live URL| Hub
    Hub -->|15. Displays Live URL| UI
    
    %% Styling
    classDef frontend fill:#0c0c0c,stroke:#fff,stroke-width:2px,color:#fff;
    classDef orchestrator fill:#1e1e1e,stroke:#a1a1aa,stroke-width:2px,color:#fff;
    classDef pollinations fill:#facc15,stroke:#000,stroke-width:2px,color:#000;
    classDef cloudflare fill:#f97316,stroke:#000,stroke-width:2px,color:#fff;
    
    class UI frontend;
    class Hub orchestrator;
    class PollImg,PollText,QCAgent,ModelA,ModelB pollinations;
    class R2,CFPages cloudflare;