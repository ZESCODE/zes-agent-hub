// zes-agent-hub — Core AgoraHub Agent Orchestration Server
// Express server providing seat management, channels, delegations, and message passing

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { runCouncil } from './lib/council.js';
import { qcCheck } from './lib/qc.js';
import { runFreeTier, runPremium } from './lib/deploy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

app.use(cors());
app.use(express.json());

// In-memory state (replace with SQLite/Postgres in production)
const state = {
  seats: new Map(),
  channels: new Map(),
  messages: [],
  delegations: new Map(),
  missions: new Map(),
};

// Initialize from seats config
let seatsConfig = {};
try {
  seatsConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../seats/config.json'), 'utf-8'));
} catch (e) {
  console.warn('Could not load seats config, using defaults');
}

// Register seats
for (const seat of seatsConfig.seats || []) {
  state.seats.set(seat.id, {
    ...seat,
    status: 'idle',
    inbox: [],
    lastActive: null,
    createdAt: new Date().toISOString(),
  });
}

// Register missions
for (const seat of seatsConfig.seats || []) {
  state.missions.set(seat.id, seat.mission);
}

// Register delegations
for (const dep of seatsConfig.delegations || []) {
  state.delegations.set(`${dep.from}->${dep.to}`, dep);
}

// Create default council channel
state.channels.set(seatsConfig.councilChannel || 'council-channel', {
  name: seatsConfig.councilChannel || 'council-channel',
  type: 'private',
  members: seatsConfig.seats
    .filter(s => s.id !== 'castor')
    .map(s => s.id),
  createdAt: new Date().toISOString(),
});

// ============================================================================
// REST API Endpoints
// ============================================================================

// Health
app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'zes-agent-hub', version: '0.1.0', protocol: 'agora/0.4' });
});

// Roles (who is who)
app.get('/api/agora/roles', (req, res) => {
  const roles = Array.from(state.seats.entries()).map(([id, seat]) => ({
    id,
    nicknameModel: seat.nicknameModel,
    type: seat.type,
    role: seat.role,
    model: seat.model,
    provider: seat.provider,
    status: seat.status,
  }));
  res.json(roles);
});

// Seats
app.get('/api/agora/seats', (req, res) => {
  const seats = Array.from(state.seats.values()).map(s => ({
    id: s.id,
    nicknameModel: s.nicknameModel,
    type: s.type,
    role: s.role,
    model: s.model,
    provider: s.provider,
    status: s.status,
    mission: s.mission,
    capabilities: s.capabilities,
    lastActive: s.lastActive,
  }));
  res.json(seats);
});

// Missions
app.get('/api/agora/missions', (req, res) => {
  const missions = Array.from(state.missions.entries()).map(([id, mission]) => ({ id, mission }));
  res.json(missions);
});

// Channels
app.get('/api/agora/channels', (req, res) => {
  const channels = Array.from(state.channels.values());
  res.json(channels);
});

// Messages
app.get('/api/agora/messages', (req, res) => {
  const { channel, limit = 50 } = req.query;
  let filtered = state.messages;
  if (channel) {
    filtered = filtered.filter(m => m.channel === channel);
  }
  res.json(filtered.slice(-parseInt(limit)));
});

// Inbox for a seat
app.get('/api/agora/inbox/:seatId', (req, res) => {
  const { seatId } = req.params;
  const seat = state.seats.get(seatId);
  if (!seat) {
    return res.status(404).json({ error: 'Seat not found' });
  }
  res.json(seat.inbox);
});

// Post message
app.post('/api/agora/post', (req, res) => {
  const { channel, message, from, replyTo, model } = req.body;

  if (!channel || !message || !from) {
    return res.status(400).json({ error: 'channel, message, and from are required' });
  }

  const msg = {
    id: crypto.randomUUID(),
    channel,
    message,
    from,
    replyTo: replyTo || null,
    model: model || null,
    timestamp: new Date().toISOString(),
  };

  state.messages.push(msg);

  // Deliver to channel members
  const channelData = state.channels.get(channel);
  if (channelData) {
    for (const memberId of channelData.members) {
      if (memberId !== from) {
        const member = state.seats.get(memberId);
        if (member) {
          member.inbox.push(msg);
        }
      }
    }
  }

  // Broadcast via WebSocket
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'message', data: msg }));
    }
  });

  res.json({ ok: true, messageId: msg.id });
});

// Ack message
app.post('/api/agora/ack', (req, res) => {
  const { messageId, seatId } = req.body;
  const msg = state.messages.find(m => m.id === messageId);
  if (msg) {
    msg.ackedBy = msg.ackedBy || [];
    if (!msg.ackedBy.includes(seatId)) {
      msg.ackedBy.push(seatId);
    }
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
});

// Delegations
app.get('/api/agora/delegations', (req, res) => {
  res.json(Array.from(state.delegations.values()));
});

// Drive loop status
app.get('/api/agora/drive-status', (req, res) => {
  res.json({
    running: true,
    intervalMs: seatsConfig.driveLoopIntervalMs || 30000,
    seats: Array.from(state.seats.keys()),
    inboxCounts: Array.from(state.seats.entries()).map(([id, seat]) => ({
      seat: id,
      nicknameModel: seat.nicknameModel,
      inboxCount: seat.inbox.length,
    })),
  });
});

// Pipeline status
app.get('/api/agora/pipeline-status', (req, res) => {
  res.json({
    name: seatsConfig.pipeline?.name || 'vercel-cloudflare-build-deploy',
    stages: seatsConfig.pipeline?.stages || ['build', 'vercel-deploy', 'cloudflare-deploy'],
    template: seatsConfig.pipeline?.template || 'https://zes.codes',
    localPath: seatsConfig.pipeline?.localPath || '/data/data/com.termux/files/home/tmp/vercel/zes.codes',
  });
});


// ============================================================================
// Pipeline API (admin key required)
// ============================================================================

function requireAdmin(req, res, next) {
  const configured = process.env.AGORA_HUB_ADMIN_KEY;

  if (!configured) {
    return res.status(503).json({ error: 'AGORA_HUB_ADMIN_KEY is not configured' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token !== configured) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

function parseBody(schema, req, res) {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return null;
  }

  return parsed.data;
}

const freeSchema = z.object({
  title: z.string().min(1).max(120),
  niche: z.string().min(1).max(120),
  templateId: z.string().optional(),
  dryRun: z.boolean().optional(),
});

const premiumSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  niche: z.string().min(1).max(120).optional(),
  framework: z.string().max(60).optional(),
  deployTarget: z.enum(['vercel', 'cloudflare']).default('vercel'),
  dryRun: z.boolean().optional(),
});

const qcSchema = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().max(400).optional(),
});

app.post('/api/pipeline/free', requireAdmin, async (req, res) => {
  const body = parseBody(freeSchema, req, res);

  if (!body) {
    return;
  }

  try {
    const result = await runFreeTier({ ...body, logger: (line) => console.log('[free]', line) });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/pipeline/premium', requireAdmin, async (req, res) => {
  const body = parseBody(premiumSchema, req, res);

  if (!body) {
    return;
  }

  try {
    const result = await runPremium({ ...body, logger: (line) => console.log('[premium]', line) });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/qc/check', requireAdmin, async (req, res) => {
  const body = parseBody(qcSchema, req, res);

  if (!body) {
    return;
  }

  try {
    res.json(await qcCheck(body.imageUrl, { prompt: body.prompt }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pipeline/council', requireAdmin, async (req, res) => {
  const schema = z.object({ prompt: z.string().min(1).max(4000) });
  const body = parseBody(schema, req, res);

  if (!body) {
    return;
  }

  try {
    res.json(await runCouncil(body.prompt, { logger: (line) => console.log('[council]', line) }));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// WebSocket
// ============================================================================

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', seats: Array.from(state.seats.keys()) }));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      ws.send(JSON.stringify({ type: 'ack', original: msg }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = process.env.AGORA_HUB_PORT || 8765;
httpServer.listen(PORT, () => {
  console.log(`zes-agent-hub listening on http://localhost:${PORT}`);
  console.log(`Seats registered: ${state.seats.size}`);
  for (const [id, seat] of state.seats) {
    console.log(`  ${seat.nicknameModel} (${seat.role}) — ${seat.status}`);
  }
  console.log(`Channels: ${state.channels.size}`);
});

export default app;
