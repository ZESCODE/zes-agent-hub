// zes-agent-hub — Drive Loop
// Round-robin polls all seats for inbox messages and processes them
// For unattended seats (john, siti, laurent, labu)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seatGenText } from '../server/lib/providers/seat-call.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEATS_CONFIG_PATH = path.resolve(__dirname, '../seats/config.json');
const POLL_INTERVAL_MS = parseInt(process.env.DRIVE_LOOP_INTERVAL_MS || '30000');

let running = true;

process.on('SIGINT', () => {
  console.log('\n🛑 Drive loop stopping...');
  running = false;
});

async function processSeatInbox(seat) {
  console.log(`  📥 Polling ${seat.nicknameModel} inbox...`);

  if (seat.inbox && seat.inbox.length > 0) {
    console.log(`     Found ${seat.inbox.length} unread messages`);
    for (const msg of seat.inbox) {
      try {
        const response = await seatGenText(seat, msg.message, {
          model: seat.model,
        });
        console.log(`     ✅ Responded to message ${msg.id}`);
        console.log(`     📝 ${seat.nicknameModel}: ${response.content.substring(0, 120)}...`);
      } catch (err) {
        console.error(`     ❌ Failed to process message ${msg.id}:`, err.message);
      }
    }
  } else {
    console.log(`     Empty`);
  }
}

async function driveLoop() {
  console.log('🔄 zes-agent-hub — Drive Loop');
  console.log(`   Interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`   Press Ctrl+C to stop\n`);

  const config = JSON.parse(fs.readFileSync(SEATS_CONFIG_PATH, 'utf-8'));
  const memberSeats = config.seats.filter(s => s.type === 'member');

  while (running) {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`\n[${timestamp}] 🔄 Drive cycle starting`);

    for (const seat of memberSeats) {
      await processSeatInbox(seat);
    }

    console.log(`   ✅ Cycle complete — waiting ${POLL_INTERVAL_MS}ms`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('✅ Drive loop stopped');
}

driveLoop().catch(err => {
  console.error('❌ Drive loop error:', err.message);
  process.exit(1);
});
