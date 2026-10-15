// ============================================================
// Snake Rush Arena — Colyseus server entry (Phase 2)
// Run: npm run server:dev   (tsx watch server/index.ts)
// WebSocket on :2567 (NET.WS_PORT). Rooms auto-fill with bots.
// ============================================================
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import http from 'http';
import { NET } from '../shared/gameConstants';
import { SnakeRoom } from './rooms/SnakeRoom';

const httpServer = http.createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ name: 'snake-rush-arena-server', ok: true }));
});

const app = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

app.define('snake_room', SnakeRoom);

app.listen(NET.WS_PORT, '0.0.0.0', () => {
  console.log(`🐍 Snake Rush Arena server listening on ws://0.0.0.0:${NET.WS_PORT}`);
  console.log(`   max ${NET.MAX_ROOM_PLAYERS} players/room · tick ${NET.TICK_MS}ms · bot-fill ON`);
});

process.on('uncaughtException', e => console.error('[server] uncaught:', e));
