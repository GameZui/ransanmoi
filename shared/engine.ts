// ============================================================
// Snake Rush Arena - Core simulation engine (deterministic-ish)
// Used by: offline singleplayer (client) AND Colyseus server.
// Server-authoritative: entities only move via inputs applied here.
// ============================================================
import {
  ARENA, FOOD, SNAKE, SCORE, SKILLS, BOT_NAMES, EVENTS,
  type SkillId, type GameMode, type MatchConfig,
} from './gameConstants';

export interface EngineFood {
  id: number; x: number; y: number; v: number; gold: boolean; sz: number;
  vx?: number; vy?: number; ttl?: number; // physics crumbs / chest loot
}

export interface EngineSnake {
  id: string; name: string; bot: boolean; skillLevel: number;
  skin: string; team: number;
  x: number; y: number; ang: number; targetAng: number;
  path: number[];                 // flat [x,y,...] newest first
  len: number;                  // float length budget
  score: number; kills: number;
  alive: boolean; deadAt: number;
  boosting: boolean; boostFuel: number;
  combo: number; lastEatAt: number; feverUntil: number; rushUntil: number;
  skill: SkillId; skillReadyAt: number; skillUntil: number;
  invulnUntil: number;
  shielded: boolean; ghosting: boolean; magnetUntil: number; dashUntil: number;
  slowUntil: number;              // meteor stun
  inputAngle: number; inputBoost: boolean; pendingSkill: SkillId | null;
  respawnCount: number;
  // bot brain
  brainT: number; brainMode: 'seek' | 'hunt' | 'flee' | 'wander';
  brainTarget: { x: number; y: number } | null;
  // anti-cheat accounting (server only uses this)
  distTraveled: number; expectedDist: number; cheatStrikes: number;
}

export type EngineEvent =
  | { kind: 'kill'; x: number; y: number; color: string; big: boolean; victim: string; by: string }
  | { kind: 'eat'; x: number; y: number; gold: boolean }
  | { kind: 'skill'; who: string; skill: SkillId; x: number; y: number }
  | { kind: 'announce'; msg: string }
  | { kind: 'zone_gold'; x: number; y: number; r: number; life: number }
  | { kind: 'zone_speed'; x: number; y: number; r: number; life: number }
  | { kind: 'portal'; x: number; y: number; x2: number; y2: number; life: number }
  | { kind: 'chest'; x: number; y: number; life: number }
  | { kind: 'meteor_warn'; x: number; y: number; r: number }
  | { kind: 'meteor_boom'; x: number; y: number; r: number }
  | { kind: 'combo'; who: string; n: number; tier: 'combo' | 'fever' | 'rush' };

interface ActiveZone { kind: 'gold' | 'speed'; x: number; y: number; r: number; until: number }
interface PortalPair { a: { x: number; y: number }; b: { x: number; y: number }; until: number; cd: Map<string, number> }
interface Meteor { x: number; y: number; r: number; boomAt: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerpAngle = (cur: number, tgt: number, maxD: number) => {
  let d = tgt - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + clamp(d, -maxD, maxD);
};
export const angleDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

export class SnakeEngine {
  time = 0;                       // ms elapsed
  snakes: EngineSnake[] = [];
  foods: EngineFood[] = [];
  events: EngineEvent[] = [];     // drained each tick by host
  circle = { x: ARENA.WIDTH / 2, y: ARENA.HEIGHT / 2, r: ARENA.WIDTH * 0.75, nextR: ARENA.WIDTH * 0.75 };
  private nextFoodId = 1;
  private zones: ActiveZone[] = [];
  private portals: PortalPair[] = [];
  private meteors: Meteor[] = [];
  private nextEventAt = EVENTS.FIRST_AT;
  private shrinkPhase = 0;
  private foodTarget: number;
  onKillHook?: (by: EngineSnake | null, victim: EngineSnake) => void;

  constructor(public cfg: MatchConfig, public rngSeed = Date.now()) {
    this.foodTarget = cfg.mode === 'quick' ? 420 : FOOD.BASE_COUNT;
    for (let i = 0; i < this.foodTarget; i++) this.spawnAmbient();
  }

  // ---------- setup ----------
  addSnake(o: { id: string; name: string; bot?: boolean; skill?: SkillId; skin?: string; skillLevel?: number; team?: number }): EngineSnake {
    const s: EngineSnake = {
      id: o.id, name: o.name, bot: !!o.bot, skillLevel: o.skillLevel ?? 1,
      skin: o.skin || 'neon', team: o.team ?? 0,
      x: 0, y: 0, ang: 0, targetAng: 0, path: [],
      len: SNAKE.START_LENGTH, score: 0, kills: 0,
      alive: true, deadAt: 0, boosting: false, boostFuel: 100,
      combo: 0, lastEatAt: -9999, feverUntil: 0, rushUntil: 0,
      skill: o.skill || 'dash', skillReadyAt: 0, skillUntil: 0,
      invulnUntil: this.time + SNAKE.INVULN_MS,
      shielded: false, ghosting: false, magnetUntil: 0, dashUntil: 0, slowUntil: 0,
      inputAngle: 0, inputBoost: false, pendingSkill: null, respawnCount: 0,
      brainT: 0, brainMode: 'seek', brainTarget: null,
      distTraveled: 0, expectedDist: 0, cheatStrikes: 0,
    };
    this.placeAtSafeSpot(s);
    this.snakes.push(s);
    return s;
  }

  removeSnake(id: string) {
    const idx = this.snakes.findIndex(s => s.id === id);
    if (idx >= 0) { const [s] = this.snakes.splice(idx, 1); if (s.alive) this.explode(s); }
  }

  getSnake(id: string) { return this.snakes.find(s => s.id === id); }

  private placeAtSafeSpot(s: EngineSnake) {
    for (let tries = 0; tries < 40; tries++) {
      const x = rand(300, ARENA.WIDTH - 300), y = rand(300, ARENA.HEIGHT - 300);
      let ok = true;
      for (const t of this.zones) if (t.kind === 'speed') continue;
      for (const o of this.snakes) if (o !== s && o.alive && Math.hypot(o.x - x, o.y - y) < 260) { ok = false; break; }
      if (this.circle.r < ARENA.WIDTH * 0.7 && Math.hypot(x - this.circle.x, y - this.circle.y) > this.circle.r - 180) ok = false;
      if (ok) {
        s.x = x; s.y = y; s.ang = rand(-Math.PI, Math.PI); s.targetAng = s.ang;
        s.path = [];
        for (let i = 0; i < 60; i++) s.path.push(x - Math.cos(s.ang) * i * 3, y - Math.sin(s.ang) * i * 3);
        s.invulnUntil = this.time + SNAKE.INVULN_MS;
        return;
      }
    }
    s.x = rand(400, ARENA.WIDTH - 400); s.y = rand(400, ARENA.HEIGHT - 400);
  }

  private spawnAmbient(x?: number, y?: number, forceGold = false) {
    const gold = forceGold || Math.random() < FOOD.GOLD_CHANCE;
    this.foods.push({
      id: this.nextFoodId++,
      x: x ?? rand(60, ARENA.WIDTH - 60),
      y: y ?? rand(60, ARENA.HEIGHT - 60),
      v: gold ? FOOD.GOLD_VALUE : FOOD.BASE_VALUE,
      gold, sz: gold ? 8 : rand(FOOD.SIZE_MIN, FOOD.SIZE_MAX),
    });
  }

  private spawnCrumb(x: number, y: number, value: number) {
    const a = rand(-Math.PI, Math.PI), sp = rand(20, 90);
    this.foods.push({
      id: this.nextFoodId++, x, y, v: value, gold: value >= 3,
      sz: value >= 3 ? 8 : rand(6, 9),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: rand(28000, 45000),
    });
  }

  // ---------- main tick ----------
  step(dtMs: number) {
    const dt = dtMs / 1000;
    this.time += dtMs;
    this.events.length = 0;

    this.updateCircle(dt);
    this.updateZones();
    this.updatePortals();
    this.updateMeteors();
    this.scheduleEvents();

    for (const s of this.snakes) {
      if (!s.alive) { this.tryRespawn(s); continue; }
      if (s.bot) this.thinkBot(s, dt);
      this.applySkill(s);
      this.moveSnake(s, dt);
    }
    this.handleCollisions();
    this.eatAndMagnet(dt);
    this.updateCrumbs(dt);
    this.replenishFood();
  }

  private updateCircle(dt: number) {
    if (this.cfg.mode !== 'br') return;
    const start = this.cfg.shrinkStart ?? 45_000;
    if (this.time < start) return;
    const phases = [0.72, 0.5, 0.32, 0.18, 0.08, 0.02];
    const phaseLen = 28_000;
    const p = Math.floor((this.time - start) / phaseLen);
    if (p >= phases.length) { this.circle.nextR = 120; }
    else if (p > this.shrinkPhase || (p === 0 && this.shrinkPhase === 0 && this.circle.nextR > ARENA.WIDTH * 0.7)) {
      if (p + 1 > this.shrinkPhase) {
        this.shrinkPhase = p + 1;
        this.circle.nextR = ARENA.WIDTH * phases[Math.min(p, phases.length - 1)];
        if (p < phases.length) this.events.push({ kind: 'announce', msg: `⚠ VÒNG BO ĐANG THU HẸP! (pha ${p + 1}/${phases.length})` });
      }
    }
    const rate = (ARENA.WIDTH * 0.02) * dt; // px per sec shrink
    if (this.circle.r > this.circle.nextR) this.circle.r = Math.max(this.circle.nextR, this.circle.r - rate * 2.2);
    // drift center toward remaining players occasionally
  }

  private updateZones() {
    this.zones = this.zones.filter(z => z.until > this.time);
    for (const z of this.zones) {
      if (z.kind === 'gold') {
        // sprinkle golden orbs inside zone periodically
        if (Math.random() < 0.08) {
          const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * z.r;
          this.spawnAmbient(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, true);
        }
      }
    }
  }

  private updatePortals() {
    this.portals = this.portals.filter(p => p.until > this.time);
  }

  private updateMeteors() {
    for (const m of this.meteors as Array<Meteor & { exploded?: boolean }>) {
      if (this.time >= m.boomAt && !m.exploded) {
        m.exploded = true;
        this.events.push({ kind: 'meteor_boom', x: m.x, y: m.y, r: m.r });
        // kill snakes caught in blast (unless shield/ghost/invuln), scatter food ring
        for (const s of this.snakes) {
          if (!s.alive) continue;
          if (Math.hypot(s.x - m.x, s.y - m.y) < m.r + 20) {
            if (this.time > s.invulnUntil && !s.shielded && !s.ghosting) this.killSnake(s, null);
            else s.slowUntil = this.time + 1200;
          }
        }
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          this.spawnCrumb(m.x + Math.cos(a) * (m.r + 30), m.y + Math.sin(a) * (m.r + 30), 2);
        }
      }
    }
    this.meteors = this.meteors.filter(m => !(m as any).exploded);
  }

  private scheduleEvents() {
    if (this.time < this.nextEventAt) return;
    this.nextEventAt = this.time + rand(EVENTS.MIN_GAP, EVENTS.MAX_GAP);
    const pool: string[] = ['gold', 'speed', 'portal', 'chest', 'meteor'];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const cx = rand(500, ARENA.WIDTH - 500), cy = rand(500, ARENA.HEIGHT - 500);
    switch (pick) {
      case 'gold': {
        const r = rand(260, 380);
        this.zones.push({ kind: 'gold', x: cx, y: cy, r, until: this.time + EVENTS.GOLD_ZONE_LIFE });
        this.events.push({ kind: 'zone_gold', x: cx, y: cy, r, life: EVENTS.GOLD_ZONE_LIFE });
        this.events.push({ kind: 'announce', msg: '✨ VÙNG NĂNG LƯỢNG VÀNG xuất hiện!' });
        break;
      }
      case 'speed': {
        const r = rand(220, 300);
        this.zones.push({ kind: 'speed', x: cx, y: cy, r, until: this.time + EVENTS.SPEED_ZONE_LIFE });
        this.events.push({ kind: 'zone_speed', x: cx, y: cy, r, life: EVENTS.SPEED_ZONE_LIFE });
        this.events.push({ kind: 'announce', msg: '🌀 VÙNG TĂNG TỐC xuất hiện!' });
        break;
      }
      case 'portal': {
        const x2 = rand(500, ARENA.WIDTH - 500), y2 = rand(500, ARENA.HEIGHT - 500);
        this.portals.push({ a: { x: cx, y: cy }, b: { x: x2, y: y2 }, until: this.time + EVENTS.PORTAL_LIFE, cd: new Map() });
        this.events.push({ kind: 'portal', x: cx, y: cy, x2, y2, life: EVENTS.PORTAL_LIFE });
        this.events.push({ kind: 'announce', msg: '🌀 CỔNG DỊCH CHUYỂN đã mở!' });
        break;
      }
      case 'chest': {
        this.events.push({ kind: 'chest', x: cx, y: cy, life: EVENTS.CHEST_LIFE });
        this.events.push({ kind: 'announce', msg: '🎁 RƯƠNG NĂNG LƯỢNG HIẾM xuất hiện!' });
        // chest is implemented as cluster of valuable crumbs guarded by nothing special
        for (let i = 0; i < 10; i++) {
          const a = rand(0, Math.PI * 2), rr = rand(0, 40);
          this.spawnCrumb(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3);
        }
        break;
      }
      case 'meteor': {
        const mx = rand(400, ARENA.WIDTH - 400), my = rand(400, ARENA.HEIGHT - 400);
        this.meteors.push({ x: mx, y: my, r: 150, boomAt: this.time + EVENTS.METEOR_WARN } as Meteor & { exploded?: boolean });
        this.events.push({ kind: 'meteor_warn', x: mx, y: my, r: 150 });
        this.events.push({ kind: 'announce', msg: '☄ THIÊN THẠCH sắp rơi — tránh ra!' });
        break;
      }
    }
  }

  // ---------- skills ----------
  private applySkill(s: EngineSnake) {
    if (s.pendingSkill) {
      const sk = s.pendingSkill; s.pendingSkill = null;
      if (this.time >= s.skillReadyAt && s.alive) {
        const def = SKILLS[sk];
        s.skillReadyAt = this.time + def.cooldown;
        if (def.duration > 0) s.skillUntil = this.time + def.duration;
        switch (sk) {
          case 'dash': s.dashUntil = this.time + def.duration; break;
          case 'shield': s.shielded = true; break;
          case 'magnet': s.magnetUntil = this.time + def.duration; break;
          case 'ghost': s.ghosting = true; break;
          case 'shockwave': {
            this.events.push({ kind: 'skill', who: s.id, skill: sk, x: s.x, y: s.y });
            for (const o of this.snakes) {
              if (o === s || !o.alive) continue;
              const d = Math.hypot(o.x - s.x, o.y - s.y);
              if (d < 240) {
                const push = 170 * (1 - d / 240);
                const a = Math.atan2(o.y - s.y, o.x - s.x);
                o.x += Math.cos(a) * push; o.y += Math.sin(a) * push;
                o.slowUntil = this.time + 700;
                // trim path so it doesn't stretch
                for (let i = 0; i < o.path.length; i += 2) { /* path naturally catches up */ }
                if (this.time > o.invulnUntil && !o.shielded && !o.ghosting && push > 120) {
                  o.len = Math.max(SNAKE.MIN_LENGTH, o.len - 4);
                }
              }
            }
            for (const f of this.foods) {
              const d = Math.hypot(f.x - s.x, f.y - s.y);
              if (d < 200 && d > 1) { const a = Math.atan2(f.y - s.y, f.x - s.x); f.x += Math.cos(a) * 60; f.y += Math.sin(a) * 60; }
            }
            break;
          }
        }
        this.events.push({ kind: 'skill', who: s.id, skill: sk, x: s.x, y: s.y });
      }
    }
    // expire
    if (s.shielded && this.time > s.skillUntil) s.shielded = false;
    if (s.ghosting && this.time > s.skillUntil) s.ghosting = false;
  }

  // ---------- movement ----------
  private moveSnake(s: EngineSnake, dt: number) {
    const speedZone = this.zones.some(z => z.kind === 'speed' && Math.hypot(s.x - z.x, s.y - z.y) < z.r);
    let speed = s.boosting ? SNAKE.BOOST_SPEED : SNAKE.BASE_SPEED;
    if (s.dashUntil > this.time) speed = SNAKE.BOOST_SPEED * 1.55;
    if (speedZone) speed *= 1.35;
    if (s.slowUntil > this.time) speed *= 0.45;
    // size slows handling slightly (turn radius grows with length)
    const growFactor = 1 / (1 + Math.max(0, (s.len - 30)) * 0.004);
    const turn = SNAKE.TURN_RATE * (0.55 + 0.45 * growFactor) * (s.boosting ? 0.8 : 1);
    s.ang = lerpAngle(s.ang, s.targetAng, turn * dt);

    const dx = Math.cos(s.ang) * speed * dt, dy = Math.sin(s.ang) * speed * dt;
    s.x += dx; s.y += dy;
    s.distTraveled += Math.hypot(dx, dy);
    s.expectedDist += speed * dt;

    // boost consumes fuel then length
    if (s.boosting && s.dashUntil <= this.time) {
      s.boostFuel = Math.max(0, s.boostFuel - 42 * dt);
      if (s.boostFuel <= 0 && s.len > SNAKE.MIN_LENGTH + 2) {
        s.len = Math.max(SNAKE.MIN_LENGTH, s.len - SNAKE.BOOST_DRAIN_LEN * dt);
      }
    } else {
      s.boostFuel = Math.min(100, s.boostFuel + 26 * dt);
    }

    // wall death (BR: circle edge also kills)
    const m = ARENA.WALL_MARGIN;
    const outWall = s.x < m || s.x > ARENA.WIDTH - m || s.y < m || s.y > ARENA.HEIGHT - m;
    let outCircle = false;
    if (this.cfg.mode === 'br' && this.circle.r < ARENA.WIDTH * 0.7) {
      outCircle = Math.hypot(s.x - this.circle.x, s.y - this.circle.y) > this.circle.r;
    }
    if ((outWall || outCircle) && !s.ghosting) { this.killSnake(s, null); return; }
    s.x = clamp(s.x, m, ARENA.WIDTH - m);
    s.y = clamp(s.y, m, ARENA.HEIGHT - m);

    // record path
    s.path.unshift(s.x, s.y);
    const need = Math.ceil(s.len) * SNAKE.SEG_SPACING + 30;
    const maxPts = Math.ceil(need / 3) * 2 + 2;   // keep path trimmed to needed length
    if (s.path.length > maxPts) s.path.length = maxPts;
  }

  // ---------- collisions (spatial-grid accelerated) ----------
  private handleCollisions() {
    // Build a uniform grid over body sample points of every alive snake.
    const CELL = 90;
    const gw = Math.ceil(ARENA.WIDTH / CELL), gh = Math.ceil(ARENA.HEIGHT / CELL);
    const grid: Map<number, { x: number; y: number; owner: EngineSnake }> = new Map();
    const key = (cx: number, cy: number) => cx + cy * gw;
    for (const o of this.snakes) {
      if (!o.alive) continue;
      const stepK = 2; // sample every 2nd segment -> good balance of precision/perf
      for (let k = 1; k < o.len; k += stepK) {
        const bp = this.sampleBody(o, k);
        if (!bp) break;
        const kk = key(Math.floor(bp.x / CELL), Math.floor(bp.y / CELL));
        let arr = grid.get(kk);
        if (!arr) { const fresh: any = { x: bp.x, y: bp.y, owner: o, list: [bp] }; grid.set(kk, fresh); }
        else ((arr as any).list as { x: number; y: number }[]).push(bp);
      }
    }
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.ghosting || s.shielded || this.time < s.invulnUntil) continue;
      const headR = SNAKE.HEAD_RADIUS + Math.min(10, s.len * 0.05);
      const hitR = headR + SNAKE.BODY_BASE_R;
      const cx = Math.floor(s.x / CELL), cy = Math.floor(s.y / CELL);
      let killer: EngineSnake | null = null;
      outer:
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = grid.get(key(cx + dx, cy + dy));
          if (!cell) continue;
          const owner = cell.owner;
          if (owner === s) continue;
          if (this.cfg.mode === 'team' && s.team === owner.team) continue;
          // cheap whole-cell reject
          if (Math.abs(s.x - cell.x) > CELL + hitR + 40 && (cell as any).list.length > 1) { /* still check list */ }
          for (const bp of (cell as any).list as { x: number; y: number }[]) {
            const ddx = bp.x - s.x, ddy = bp.y - s.y;
            if (ddx * ddx + ddy * ddy < hitR * hitR) { killer = owner; break outer; }
          }
        }
      }
      if (killer) this.killSnake(s, killer);
    }
  }

  /** Sample point at segment index along snake path (stable helper). */
  sampleBody(s: EngineSnake, segIdx: number): { x: number; y: number } | null {
    const dist = (segIdx + 1) * SNAKE.SEG_SPACING;
    let acc = 0;
    for (let i = 2; i < s.path.length; i += 2) {
      const ax = s.path[i - 2], ay = s.path[i - 1];
      const bx = s.path[i], by = s.path[i + 1];
      const d = Math.hypot(ax - bx, ay - by);
      if (acc + d >= dist) {
        const t = d > 0 ? (dist - acc) / d : 0;
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
      }
      acc += d;
    }
    return null;
  }

  // ---------- eating ----------
  private eatAndMagnet(dt: number) {
    const eatR = FOOD.EAT_DIST;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const magnet = s.magnetUntil > this.time;
      const pullR = magnet ? FOOD.MAGNET_RADIUS : 0;
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        const d = Math.hypot(f.x - s.x, f.y - s.y);
        if (pullR > 0 && d < pullR && d > 1) {
          const pull = 320 * dt;
          f.x += ((s.x - f.x) / d) * pull;
          f.y += ((s.y - f.y) / d) * pull;
        }
        if (d < eatR + (f.gold ? 4 : 0)) {
          this.foods.splice(i, 1);
          this.onEat(s, f);
        }
      }
      // portal teleport
      for (const p of this.portals) {
        const cd = p.cd.get(s.id) || 0;
        if (this.time < cd) continue;
        if (Math.hypot(s.x - p.a.x, s.y - p.a.y) < 42) { s.x = p.b.x; s.y = p.b.y; p.cd.set(s.id, this.time + 900); this.trimPath(s); }
        else if (Math.hypot(s.x - p.b.x, s.y - p.b.y) < 42) { s.x = p.a.x; s.y = p.a.y; p.cd.set(s.id, this.time + 900); this.trimPath(s); }
      }
    }
  }

  private trimPath(s: EngineSnake) {
    // after teleport the old tail path is invalid; rebuild straight stub behind head
    s.path = [];
    for (let i = 0; i < 40; i++) s.path.push(s.x - Math.cos(s.ang) * i * 3, s.y - Math.sin(s.ang) * i * 3);
  }

  private onEat(s: EngineSnake, f: EngineFood) {
    s.combo = (this.time - s.lastEatAt < SCORE.COMBO_WINDOW_MS) ? s.combo + 1 : 1;
    s.lastEatAt = this.time;
    let mult = 1;
    if (s.rushUntil > this.time) mult = SCORE.GOLDRUSH_MULT;
    else if (s.feverUntil > this.time) mult = SCORE.FEVER_MULT;
    const base = SCORE.PER_ORB * f.v * (f.gold ? SCORE.GOLD_MULTIPLIER : 1);
    const comboBonus = 1 + Math.min(s.combo, 25) * 0.04;
    s.score += Math.round(base * mult * comboBonus);
    s.len += f.gold ? 1.6 : 0.85;
    this.events.push({ kind: 'eat', x: f.x, y: f.y, gold: f.gold });
    if (s.combo === 5) this.events.push({ kind: 'combo', who: s.id, n: 5, tier: 'combo' });
    if (s.combo === SCORE.FEVER_AT && s.feverUntil <= this.time) {
      s.feverUntil = this.time + SCORE.FEVER_DURATION;
      this.events.push({ kind: 'combo', who: s.id, n: s.combo, tier: 'fever' });
    }
    if (s.combo === SCORE.GOLDRUSH_AT) {
      s.rushUntil = this.time + SCORE.GOLDRUSH_DURATION;
      s.feverUntil = 0;
      this.events.push({ kind: 'combo', who: s.id, n: s.combo, tier: 'rush' });
    }
    // combo decay check
    if (this.time - s.lastEatAt > SCORE.COMBO_WINDOW_MS) s.combo = 0;
  }

  // ---------- deaths ----------
  killSnake(s: EngineSnake, by: EngineSnake | null) {
    if (!s.alive) return;
    s.alive = false;
    s.deadAt = this.time;
    s.combo = 0; s.feverUntil = 0; s.rushUntil = 0;
    // drop body as energy orbs
    const drops = Math.min(60, Math.floor(s.len * 1.1) + 6);
    for (let i = 0; i < drops; i++) {
      const bp = this.sampleBody(s, Math.floor((i / drops) * s.len)) || { x: s.x, y: s.y };
      this.spawnCrumb(bp.x + rand(-8, 8), bp.y + rand(-8, 8), s.len > 60 ? 3 : 2);
    }
    this.events.push({ kind: 'kill', x: s.x, y: s.y, color: '#fff', big: s.len > 50, victim: s.name, by: by?.name || 'Arena' });
    if (by) {
      const pts = SCORE.KILL_BASE + Math.round(by.score === undefined ? 0 : Math.min(by.len, 120) * 2);
      by.score += pts;
      by.kills += 1;
      by.len = Math.min(SNAKE.MAX_GROWTH + 80, by.len + 6);
    }
    this.onKillHook?.(by, s);
  }

  private tryRespawn(s: EngineSnake) {
    const aliveCount = this.snakes.filter(x => x.alive).length;
    const soloOk = this.cfg.mode === 'classic' || this.cfg.mode === 'practice' || this.cfg.mode === 'quick' || this.cfg.mode === 'team';
    if (!soloOk) return;                        // BR/team handled externally
    if (this.time - s.deadAt < SNAKE.RESPAWN_DELAY) return;
    if (aliveCount <= 1 && this.snakes.length > 1 && !s.bot) {
      // don't auto-respawn into an empty world instantly; still allow in classic
    }
    s.respawnCount++;
    s.alive = true;
    s.len = SNAKE.START_LENGTH;
    s.boostFuel = 100;
    s.skillReadyAt = 0; s.shielded = s.ghosting = false;
    this.placeAtSafeSpot(s);
  }

  private explode(s: EngineSnake) { /* used on disconnect: silently drop */ }

  private updateCrumbs(dt: number) {
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (f.vx !== undefined) {
        f.x += f.vx! * dt; f.y += f.vy! * dt;
        f.vx! *= 0.9; f.vy! *= 0.9;
        f.x = clamp(f.x, 40, ARENA.WIDTH - 40); f.y = clamp(f.y, 40, ARENA.HEIGHT - 40);
      }
      if (f.ttl !== undefined) {
        f.ttl -= dt * 1000;
        if (f.ttl <= 0) this.foods.splice(i, 1);
      }
    }
  }

  private replenishFood() {
    const ambient = this.foods.filter(f => f.vx === undefined).length;
    if (ambient < this.foodTarget) {
      const add = Math.min(6, this.foodTarget - ambient);
      for (let i = 0; i < add; i++) this.spawnAmbient();
    }
  }

  // ================= BOT AI =================
  thinkBot(s: EngineSnake, dt: number) {
    s.brainT -= dt;
    const lvl = s.skillLevel; // 1..3
    const dangerR = 90 + lvl * 40;

    // 1) survival: find nearest threat (enemy body ahead of head)
    let fleeFrom: { x: number; y: number } | null = null;
    let bestThreatD = Infinity;
    for (const o of this.snakes) {
      if (o === s || !o.alive) continue;
      if (this.cfg.mode === 'team' && o.team === s.team) continue;
      const dHead = Math.hypot(o.x - s.x, o.y - s.y);
      if (dHead > 420) continue;
      // sample a few body points of o
      const segs = Math.max(2, Math.floor(o.len / 6));
      for (let k = 0; k < segs; k++) {
        const bp = this.sampleBody(o, k * 6 + 2);
        if (!bp) break;
        const d = Math.hypot(bp.x - s.x, bp.y - s.y);
        if (d < bestThreatD) { bestThreatD = d; fleeFrom = bp; }
      }
      // head-on collision risk
      if (dHead < 120 && angleDiff(Math.atan2(s.y - o.y, s.x - o.x), o.ang) < 0.5 && o.len >= s.len * 0.8) {
        bestThreatD = Math.min(bestThreatD, 40); fleeFrom = { x: o.x, y: o.y };
      }
    }

    // wall / circle avoidance
    const m = 220;
    let wallPush: { x: number; y: number } | null = null;
    if (s.x < m || s.y < m || s.x > ARENA.WIDTH - m || s.y > ARENA.HEIGHT - m) {
      wallPush = { x: ARENA.WIDTH / 2, y: ARENA.HEIGHT / 2 };
    }
    if (this.cfg.mode === 'br' && this.circle.r < ARENA.WIDTH * 0.7) {
      const dc = Math.hypot(s.x - this.circle.x, s.y - this.circle.y);
      if (dc > this.circle.r - 260) wallPush = { x: this.circle.x, y: this.circle.y };
    }

    // 2) decide mode
    const canHunt = lvl >= 2 && s.len > 18;
    let prey: EngineSnake | null = null;
    if (canHunt) {
      let bd = 380;
      for (const o of this.snakes) {
        if (o === s || !o.alive || o.len >= s.len * 0.75) continue;
        if (this.time < o.invulnUntil) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < bd) { bd = d; prey = o; }
      }
    }
    const fleeing = bestThreatD < dangerR;
    if (fleeing) s.brainMode = 'flee';
    else if (prey) s.brainMode = 'hunt';
    else if (s.brainT <= 0 || !s.brainTarget) {
      s.brainMode = 'seek';
      s.brainT = rand(1.5, 3);
      s.brainTarget = this.findFoodCluster(s);
    }

    // 3) steering target
    let tx = s.x + Math.cos(s.ang) * 200, ty = s.y + Math.sin(s.ang) * 200;
    if (s.brainMode === 'flee' && fleeFrom) {
      const a = Math.atan2(s.y - fleeFrom.y, s.x - fleeFrom.x);
      tx = s.x + Math.cos(a) * 260; ty = s.y + Math.sin(a) * 260;
      // smart dodge: turn perpendicular if directly behind body
      if (lvl >= 2) {
        const perp = a + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        tx = s.x + Math.cos(perp) * 200; ty = s.y + Math.sin(perp) * 200;
      }
    } else if (s.brainMode === 'hunt' && prey) {
      // cut off: aim ahead of prey along its heading, prefer circling above/below
      const lead = 60 + lvl * 30;
      const side = (prey as any)._side || ((prey as any)._side = Math.random() < 0.5 ? 1 : -1);
      const px = prey.x + Math.cos(prey.ang) * lead;
      const py = prey.y + Math.sin(prey.ang) * lead + side * (30 + prey.len * 0.4);
      tx = px; ty = py;
      // encircle: if close and big advantage, swing around prey
      if (lvl >= 3 && Math.hypot(px - s.x, py - s.y) < 140) {
        const a = Math.atan2(prey.y - s.y, prey.x - s.x) + side * 1.4;
        tx = s.x + Math.cos(a) * 160; ty = s.y + Math.sin(a) * 160;
      }
    } else if (s.brainTarget) {
      tx = s.brainTarget.x; ty = s.brainTarget.y;
    }
    if (wallPush) {
      const aw = Math.atan2(wallPush.y - s.y, wallPush.x - s.x);
      const at = Math.atan2(ty - s.y, tx - s.x);
      const blended = lerpAngle(at, aw, 1.2);
      tx = s.x + Math.cos(blended) * 240; ty = s.y + Math.sin(blended) * 240;
    }

    s.inputAngle = Math.atan2(ty - s.y, tx - s.x);
    s.targetAng = s.inputAngle;

    // boost decisions
    const wantBoostFlee = fleeing && s.boostFuel > 25 && lvl >= 1;
    const wantBoostHunt = s.brainMode === 'hunt' && prey && Math.hypot(prey.x - s.x, prey.y - s.y) < 200 && s.boostFuel > 40 && lvl >= 2;
    s.inputBoost = !!(wantBoostFlee || wantBoostHunt) && s.len > SNAKE.MIN_LENGTH + 4;

    // skill usage
    if (this.time >= s.skillReadyAt && Math.random() < 0.02 * lvl) {
      if (s.skill === 'shockwave' && (fleeing || s.brainMode === 'hunt')) s.pendingSkill = 'shockwave';
      else if (s.skill === 'shield' && fleeing) s.pendingSkill = 'shield';
      else if (s.skill === 'dash' && (fleeing || wantBoostHunt)) s.pendingSkill = 'dash';
      else if (s.skill === 'magnet' && s.brainMode === 'seek') s.pendingSkill = 'magnet';
      else if (s.skill === 'ghost' && fleeing) s.pendingSkill = 'ghost';
    }
  }

  private findFoodCluster(s: EngineSnake): { x: number; y: number } {
    // sample random foods, weight by proximity + value (cheap O(k) heuristic)
    let best = { x: s.x + Math.cos(s.ang) * 300, y: s.y + Math.sin(s.ang) * 300, score: -Infinity };
    const N = 26;
    for (let i = 0; i < N; i++) {
      const f = this.foods[Math.floor(Math.random() * this.foods.length)];
      if (!f) continue;
      const d = Math.hypot(f.x - s.x, f.y - s.y);
      if (d > 700) continue;
      // count neighbors within 90px (cluster density)
      let dens = 0;
      for (let j = 0; j < 10; j++) {
        const g = this.foods[Math.floor(Math.random() * this.foods.length)];
        if (g && Math.hypot(g.x - f.x, g.y - f.y) < 110) dens++;
      }
      const val = (f.gold ? 3 : 1) + dens * 1.4 - d / 240;
      if (val > best.score) best = { x: f.x, y: f.y, score: val };
    }
    // steer toward zones sometimes
    for (const z of this.zones) {
      if (z.kind === 'gold' && Math.hypot(z.x - s.x, z.y - s.y) < 800 && Math.random() < 0.5) return { x: z.x, y: z.y };
    }
    return { x: best.x, y: best.y };
  }

  // ---------- leaderboard ----------
  leaderboard(n = 10) {
    return [...this.snakes].sort((a, b) => b.score - a.score).slice(0, n)
      .map(s => ({ id: s.id, name: s.name, score: s.score, len: Math.round(s.len), you: false }));
  }

  totalAlive() { return this.snakes.filter(s => s.alive).length; }
}

export function makeBotSkill(): SkillId {
  return SKILLS_ORDER_LOCAL[Math.floor(Math.random() * SKILLS_ORDER_LOCAL.length)];
}
const SKILLS_ORDER_LOCAL: SkillId[] = ['dash', 'shield', 'magnet', 'ghost', 'shockwave'];

export function randomBotName(used: Set<string>): string {
  const free = BOT_NAMES.filter(n => !used.has(n));
  const pool = free.length ? free : BOT_NAMES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  return used.has(base) ? base + Math.floor(rand(10, 99)) : base;
}
