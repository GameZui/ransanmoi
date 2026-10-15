// ============================================================
// Snake Rush Arena — Colyseus multiplayer room (Phase 2)
// Server-authoritative: runs the shared SnakeEngine; clients only
// send inputs. Snapshots at NET.TICK_MS with delta food updates,
// proximity-filtered events, bot auto-fill and basic anti-cheat.
// ============================================================
import { Room, type Client } from 'colyseus';
import {
  NET, MODES, SKINS, type GameMode, type SkillId, type SkinId, type ServerSnap,
} from '../../shared/gameConstants';
import { SnakeEngine, randomBotName, makeBotSkill } from '../../shared/engine';

const SKILL_IDS: SkillId[] = ['dash', 'shield', 'magnet', 'ghost', 'shockwave'];

export class SnakeRoom extends Room {
  engine!: SnakeEngine;
  maxClients = NET.MAX_ROOM_PLAYERS;
  private lastFoodIds = new Set<number>();
  private inputRate = new Map<string, number>();
  private usedNames = new Set<string>();
  private snakeByClient = new Map<string, string>(); // sessionId -> snakeId
  private botsFilled = false;

  onCreate(options: { mode?: GameMode }) {
    const mode = (options.mode as GameMode) || 'classic';
    this.engine = new SnakeEngine(MODES[mode] || MODES.classic);
    console.log(`[room ${this.roomId}] created mode=${mode}`);
    this.setSimulationInterval(() => this.step(), NET.TICK_MS);

    this.onMessage('*', (client, msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'input') this.handleInput(client, msg);
      else if (msg.t === 'respawn') this.handleRespawn(client);
      else if (msg.t === 'ping') client.send('pong', { ts: msg.ts });
    });
  }

  onJoin(client: Client, options: { name?: string; skin?: SkinId; skill?: SkillId }) {
    const name = sanitize(options.name) || ('Player' + Math.floor(Math.random() * 900 + 100));
    const skin = SKINS.some(s => s.id === options.skin) ? options.skin! : 'neon';
    const skill: SkillId = SKILL_IDS.includes(options.skill as SkillId) ? options.skill! : 'dash';
    const s = this.engine.addSnake({ id: client.sessionId, name: unique(name, this.usedNames), bot: false, skin, skill });
    this.snakeByClient.set(client.sessionId, s.id);
    this.botsFilled = false;
    console.log(`[room ${this.roomId}] join ${s.name}`);
  }

  onLeave(client: Client) {
    const id = this.snakeByClient.get(client.sessionId);
    if (id) { this.engine.removeSnake(id); this.snakeByClient.delete(client.sessionId); }
    this.inputRate.delete(client.sessionId);
  }

  onDispose() { console.log(`[room ${this.roomId}] disposed`); }

  // ---------- simulation tick ----------
  private step() {
    this.fillBots();
    this.engine.step(NET.TICK_MS);

    // drain & route events
    const events = [...this.engine.events];
    this.engine.events.length = 0;
    for (const ev of events) {
      const broad = ev.kind === 'announce' || ev.kind.startsWith('zone') || ev.kind === 'portal' || ev.kind === 'chest' || ev.kind.startsWith('meteor');
      if (broad) { this.broadcast('ev', ev as any); continue; }
      this.clients.forEach(c => {
        const sid = this.snakeByClient.get(c.sessionId);
        const mine = sid ? this.engine.getSnake(sid) : undefined;
        if (!mine) return;
        const ex = (ev as any).x, ey = (ev as any).y;
        const near = ex !== undefined && ey !== undefined ? Math.hypot(ex - mine.x, ey - mine.y) < 1300 : true;
        const personal = (ev.kind === 'combo' && (ev as any).who === sid)
          || (ev.kind === 'kill' && ((ev as any).victim === mine.name || (ev as any).by === mine.name))
          || (ev.kind === 'skill' && (ev as any).who === sid);
        if (near || personal) c.send('ev', ev as any);
      });
    }

    // snapshots (delta foods computed once, personalized `me`)
    const base = this.buildSnapshotBase();
    this.clients.forEach(c => {
      const sid = this.snakeByClient.get(c.sessionId);
      const me = sid ? this.engine.getSnake(sid) : undefined;
      const snap: ServerSnap = { ...base, me: null };
      snap.me = me ? netSnake(me) : null;
      if (me) for (const row of snap.lb) if (row.id === me.id) row.you = true;
      c.send('snap', snap);
    });
  }

  private fillBots() {
    if (this.clients.length === 0) return;
    const want = this.engine.cfg.snakes;
    let guard = 0;
    while (this.engine.snakes.length < want && guard++ < 4) {
      const lvl = Math.random() < 0.4 ? 1 : Math.random() < 0.75 ? 2 : 3;
      const name = unique(randomBotName(this.usedNames), this.usedNames);
      this.engine.addSnake({
        id: 'bot_' + Math.random().toString(36).slice(2, 8), name, bot: true,
        skill: makeBotSkill(), skin: SKINS[Math.floor(Math.random() * SKINS.length)].id, skillLevel: lvl,
        team: this.engine.cfg.mode === 'team' ? (this.engine.snakes.length % 2) : 0,
      });
    }
  }

  private handleInput(client: Client, msg: { angle: number; boost: boolean; skill?: SkillId }) {
    const sid = this.snakeByClient.get(client.sessionId);
    if (!sid) return;
    const s = this.engine.getSnake(sid);
    if (!s) return;
    // rate limit ~25 msgs/s per client
    const now = Date.now();
    if (now - (this.inputRate.get(client.sessionId) || 0) < 40) return;
    this.inputRate.set(client.sessionId, now);

    if (typeof msg.angle === 'number' && isFinite(msg.angle)) s.targetAng = msg.angle;
    s.boosting = !!msg.boost;
    // anti-cheat: can only trigger own skill, cooldown enforced by engine
    if (msg.skill && s.skill === msg.skill) s.pendingSkill = msg.skill;
  }

  private handleRespawn(client: Client) {
    const sid = this.snakeByClient.get(client.sessionId);
    if (!sid) return;
    const s = this.engine.getSnake(sid);
    if (s && !s.alive && this.engine.time - s.deadAt > 800) {
      s.alive = true; s.len = 10; s.boostFuel = 100;
      // reuse engine placement via public respawn path
      this.engine['placeAtSafeSpot' as any]?.(s);
    }
  }

  private buildSnapshotBase(): ServerSnap {
    const eng = this.engine;
    const curIds = new Set<number>();
    const foodsAdd: ServerSnap['foodsAdd'] = [];
    for (const f of eng.foods) {
      curIds.add(f.id);
      if (!this.lastFoodIds.has(f.id)) foodsAdd.push({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), v: f.v, g: f.gold, sz: Math.round(f.sz) });
    }
    const foodsDel: number[] = [];
    for (const id of this.lastFoodIds) if (!curIds.has(id)) foodsDel.push(id);
    this.lastFoodIds = curIds;

    return {
      tick: Math.floor(eng.time / NET.TICK_MS),
      time: Math.round(eng.time),
      left: Math.max(0, eng.cfg.durationMs - eng.time),
      circle: eng.cfg.mode === 'br' ? { x: eng.circle.x, y: eng.circle.y, r: Math.round(eng.circle.r), next: Math.round(eng.circle.nextR) } : undefined,
      snakes: eng.snakes.map(netSnake),
      foodsAdd, foodsDel, events: [], kills: [],
      lb: eng.leaderboard(10).map(x => ({ ...x, you: false })),
    } as any;
  }
}

function netSnake(s: { id: string; name: string; x: number; y: number; ang: number; len: number; score: number; boosting: boolean; alive: boolean; bot: boolean; skin: string; team: number }) {
  return {
    id: s.id, name: s.name, x: Math.round(s.x), y: Math.round(s.y), ang: round2(s.ang),
    len: Math.round(s.len * 10) / 10, score: s.score, boosts: s.boosting, dead: !s.alive,
    bot: s.bot, skin: s.skin, team: s.team,
  };
}
function round2(v: number) { return Math.round(v * 100) / 100; }
function sanitize(s = ''): string { return s.replace(/[^\p{L}\p{N} _\-\.]/gu, '').slice(0, 14).trim(); }
function unique(n: string, used: Set<string>): string {
  let out = n, i = 2;
  while (used.has(out)) out = n.slice(0, 12) + i++;
  used.add(out);
  return out;
}
