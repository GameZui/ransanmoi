// ============================================================
// Snake Rush Arena — Phaser render scene
// Renders a WorldView (offline engine tick or online snapshots)
// with neon visuals, particles, camera zoom, minimap.
// ============================================================
import Phaser from 'phaser';
import { ARENA, SNAKE, SKINS, SKILLS, skinById, type SkillId } from '@shared/gameConstants';
import { SnakeEngine, type EngineSnake } from '@shared/engine';
import type { WorldView } from '../game/LocalWorld';
import type { NetWorld } from '../game/NetWorld';
import { makeSnakeHead, makeSegmentTextures, makeFoodTextures, makeBackgroundTexture } from '../game/Textures';
import { Sfx } from '../game/Audio';
import { updateHud, showCombo, announce, killFeed, updateSkillCd, drawMinimap, destroyHud } from '../ui/UI';

const FOOD_KEYS = ['orb_cyan', 'orb_green', 'orb_pink'];

interface SnakeVisual { head?: Phaser.GameObjects.Image; segs: Phaser.GameObjects.Image[]; nameTag?: Phaser.GameObjects.Text; }

export interface MatchResultPayload { score: number; kills: number; orbs: number; maxLength: number; maxCombo: number; secondsAlive: number; won: boolean; rank: number; total: number; }

export class GameScene extends Phaser.Scene {
  world!: WorldView;
  net: NetWorld | null = null;
  onEnd?: (r: MatchResultPayload) => void;
  paused = false;
  skillsUsed = 0;

  private cam!: Phaser.Cameras.Scene2D.Camera;
  private layerBg!: Phaser.GameObjects.TileSprite;
  private layerZone!: Phaser.GameObjects.Graphics;
  private layerFood!: Phaser.GameObjects.Container;
  private layerSnake!: Phaser.GameObjects.Container;
  private sparkPool: Phaser.GameObjects.Image[] = []; private sparkIdx = 0;
  
  private visuals = new Map<string, SnakeVisual>();
  private foodSprites = new Map<number, Phaser.GameObjects.Image>();
  private poolFood: Phaser.GameObjects.Image[] = [];
  private zoneGfx = { gold: [] as { x: number; y: number; r: number; until: number }[], speed: [] as any[], portal: [] as any[], meteor: [] as any[] };
  private skill: SkillId = 'dash';
  private inputAngle = 0; boosting = false;
  private pointerDown = false; touchBoost = false;
  private startedAt = Date.now();
  private stats = { orbs: 0, maxLength: 10, maxCombo: 0 };
  private ended = false;
  private shakeUntil = 0;
  private feverTint = 0;
  private mmCtx: CanvasRenderingContext2D | null = null;
  private mmAcc = 0;
  private lowFx = false;
  private remoteTrail = new Map<string, { x: number; y: number }[]>(); // online body reconstruction

  constructor() { super('game'); }

  init(data: { world: WorldView; net?: NetWorld | null; skill: SkillId }) {
    this.world = data.world;
    this.net = data.net ?? null;
    this.skill = data.skill;
    this.ended = false;
    this.stats = { orbs: 0, maxLength: 10, maxCombo: 0 };
    this.skillsUsed = 0;
    this.startedAt = Date.now();
    this.visuals.clear(); this.remoteTrail.clear();
    this.zoneGfx = { gold: [], speed: [], portal: [], meteor: [] };
  }

  create() {
    this.lowFx = navigator.hardwareConcurrency <= 4 || /Android|iPhone/.test(navigator.userAgent);
    this.cam = this.cameras.main;
    this.cam.setBackgroundColor('#070a1c');
    // camera follows manually in updateCamera()

    makeFoodTextures(this);
    makeBackgroundTexture(this);
    for (const sk of SKINS) { makeSnakeHead(this, sk.id, sk.colors, sk.head, sk.glow); makeSegmentTextures(this, sk.id, sk.colors, sk.glow); }

    this.layerBg = this.add.tileSprite(0, 0, ARENA.WIDTH, ARENA.HEIGHT, 'bg_grid').setOrigin(0, 0).setDepth(0);
    // arena border
    const border = this.add.graphics().setDepth(5);
    border.lineStyle(6, 0x2b3f7a, 1).strokeRect(ARENA.WALL_MARGIN, ARENA.WALL_MARGIN, ARENA.WIDTH - ARENA.WALL_MARGIN * 2, ARENA.HEIGHT - ARENA.WALL_MARGIN * 2);
    border.lineStyle(14, 0x00b3ff, 0.12).strokeRect(ARENA.WALL_MARGIN - 8, ARENA.WALL_MARGIN - 8, ARENA.WIDTH - ARENA.WALL_MARGIN * 2 + 16, ARENA.HEIGHT - ARENA.WALL_MARGIN * 2 + 16);

    this.layerZone = this.add.graphics().setDepth(1);
    this.layerFood = this.add.container(0, 0).setDepth(2);
    this.layerSnake = this.add.container(0, 0).setDepth(3);
    // tiny spark texture + pool (cheap particles)
    if (!this.textures.exists('spark')) {
      const sg = this.make.graphics({ x: 0, y: 0, add: false } as any);
      sg.fillStyle(0xffffff, 1); sg.fillCircle(4, 4, 3);
      sg.generateTexture('spark', 8, 8); sg.destroy();
    }
    for (let i = 0; i < 90; i++) {
      const sp = this.add.image(0, 0, 'spark').setVisible(false).setBlendMode(Phaser.BlendModes.ADD).setDepth(7);
      this.sparkPool.push(sp);
    }

    // pre-create food pool
    const poolN = this.lowFx ? 220 : 380;
    for (let i = 0; i < poolN; i++) {
      const s = this.add.image(0, 0, FOOD_KEYS[0]).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.layerFood.add(s); this.poolFood.push(s);
    }

    // input
    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', () => { this.pointerDown = true; if (!document.body.classList.contains('touch')) this.boosting = true; });
    this.input.on('pointerup', () => { this.pointerDown = false; if (!this.touchBoost) this.boosting = false; });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    const boostBtn = document.getElementById('boost-btn');
    if (boostBtn) {
      const dn = (e: Event) => { e.preventDefault(); this.touchBoost = true; this.boosting = true; };
      const up = () => { this.touchBoost = false; this.boosting = false; };
      boostBtn.addEventListener('pointerdown', dn); boostBtn.addEventListener('pointerup', up);
      boostBtn.addEventListener('pointercancel', up); boostBtn.addEventListener('pointerleave', up);
    }
    const skBtn = document.getElementById('sk-main');
    if (skBtn) skBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.fireSkill(); });

    const mm = document.getElementById('minimap') as HTMLCanvasElement | null;
    if (mm) this.mmCtx = mm.getContext('2d');

    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKeyUp);
    });
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') { this.boosting = true; e.preventDefault(); }
    if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'ShiftLeft') this.fireSkill();
  };
  private onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') this.boosting = false; };

  private fireSkill() {
    const me = this.getMySnake();
    if (!me || !me.alive) return;
    if (this.world.engine.time >= me.skillReadyAt) {
      this.world.useSkill(this.skill);
      this.skillsUsed++;
    } else Sfx.deny();
  }

  private getMySnake(): EngineSnake | null {
    return this.world.engine.getSnake(this.world.myId) || null;
  }

  // ---------- per-frame ----------
  update(_time: number, dtMs: number) {
    if (this.paused) return;
    const eng = this.world.engine;
    const me = this.getMySnake();

    // steering: aim from screen center toward pointer
    if (me && me.alive) {
      const p = this.input.activePointer;
      const wx = this.cam.scrollX + (p.x - this.cam.width / 2) / this.cam.zoom + this.cam.width / 2 - (this.cam.width / 2) * 0;
      const wy = this.cam.scrollY + (p.y - this.cam.height / 2) / this.cam.zoom + this.cam.height / 2 - (this.cam.height / 2) * 0;
      this.inputAngle = Math.atan2(wy - me.y, wx - me.x);
      this.world.setInput(this.inputAngle, this.boosting && (me.boostFuel > 0 || me.len > SNAKE.MIN_LENGTH + 2));
      if (this.net) this.net.setInput(this.inputAngle, this.boosting, dtMs);
    }

    this.consumeEvents(eng);
    if (this.net?.lastSnap) this.consumeNetEvents();

    this.renderZones(eng);
    this.renderFoods(eng);
    this.renderSnakes(eng);
    this.updateCamera(me, dtMs);
    this.updateHudAll(eng, me);
    this.drawMini(eng, me, dtMs);
  }

  // ---------- events → fx/sound ----------
  private consumeEvents(eng: SnakeEngine) {
    if (!this.world.offline) return; // online path uses room messages
    const evs = eng.events; eng.events = [];
    for (const e of evs) this.handleEvent(e.kind, e);
  }
  private consumeNetEvents() {
    const nw = this.net!;
    const key = (nw as any)._lastEvCount || 0;
    const snap = nw.lastSnap!;
    // server pushes events via 'ev' message wired in main.ts → handled there
    void key; void snap;
  }
  handleEvent(kind: string, e: any) {
    const me = this.getMySnake();
    switch (kind) {
      case 'eat': {
        if (!this.lowFx) this.sparkBurst(e.x, e.y, e.gold ? 6 : 2, e.gold ? '#ffd44d' : '#7fffd4');
        if (me && Math.hypot(e.x - me.x, e.y - me.y) < 60) this.stats.orbs++;
        if (me && Math.hypot(e.x - me.x, e.y - me.y) < 700) {
          if (e.gold) Sfx.gold(); else Sfx.eat(me.combo ?? 0);
        }
        break;
      }
      case 'kill': {
        this.bigBurst(e.x, e.y, e.color === '#fff' ? '#ff5a6e' : e.color, e.big);
        if (me && e.victim === me.name) { Sfx.death(); this.cam.shake(300); }
        else if (me && e.by === me.name) { e.big ? Sfx.bigKill() : Sfx.kill(); this.cam.shake(120); }
        else if (Math.hypot(e.x - (me?.x ?? 1e9), e.y - (me?.y ?? 1e9)) < 900) Sfx.kill();
        killFeed(e.victim, e.by);
        break;
      }
      case 'skill': {
        if (e.who === this.world.myId) Sfx.skill(e.skill);
        else if (Math.hypot(e.x - (me?.x ?? 1e9), e.y - (me?.y ?? 1e9)) < 800) Sfx.skill(e.skill);
        if (e.skill === 'shockwave') this.sparkBurst(e.x, e.y, 16, '#ff9ad5');
        break;
      }
      case 'announce': announce(e.msg); Sfx.announce(); break;
      case 'zone_gold': this.zoneGfx.gold.push({ x: e.x, y: e.y, r: e.r, until: this.world.engine.time + e.life }); break;
      case 'zone_speed': this.zoneGfx.speed.push({ x: e.x, y: e.y, r: e.r, until: this.world.engine.time + e.life }); break;
      case 'portal': this.zoneGfx.portal.push({ a: { x: e.x, y: e.y }, b: { x: e.x2, y: e.y2 }, until: this.world.engine.time + e.life }); break;
      case 'meteor_warn': this.zoneGfx.meteor.push({ x: e.x, y: e.y, r: e.r, warnUntil: this.world.engine.time + 2200 }); break;
      case 'meteor_boom': {
        this.bigBurst(e.x, e.y, '#ff9a3d', true);
        const m = this.getMySnake();
        if (m && Math.hypot(m.x - e.x, m.y - e.y) < e.r + 300) this.cam.shake(250);
        Sfx.kill();
        break;
      }
      case 'combo': {
        if (e.who === this.world.myId) {
          showCombo(e.n, e.tier);
          if (e.tier === 'fever') Sfx.fever();
          if (e.tier === 'rush') { Sfx.goldRush(); this.feverTint = 1; }
          this.stats.maxCombo = Math.max(this.stats.maxCombo, e.n);
        }
        break;
      }
    }
  }

  private sparkBurst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const sp = this.sparkPool[this.sparkIdx++ % this.sparkPool.length];
      const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 100;
      sp.setVisible(true).setPosition(x, y).setTint(Phaser.Display.Color.HexStringToColor(color).color).setScale(.5 + Math.random()).setAlpha(1);
      this.tweens.add({ targets: sp, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 260 + Math.random() * 200, onComplete: () => sp.setVisible(false) });
    }
  }

  private bigBurst(x: number, y: number, color: string, big: boolean) {
    const n = big ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const g = this.add.circle(x, y, 3 + Math.random() * 5, Phaser.Display.Color.HexStringToColor(color).color, 1)
        .setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * (big ? 260 : 150);
      this.tweens.add({ targets: g, x: x + Math.cos(a) * sp, y: y + Math.sin(a) * sp, alpha: 0, scaleX: .1, scaleY: .1, duration: 450 + Math.random() * 300, onComplete: () => g.destroy() });
    }
  }

  // ---------- zones ----------
  private renderZones(eng: SnakeEngine) {
    const g = this.layerZone; g.clear();
    const t = eng.time;
    this.zoneGfx.gold = this.zoneGfx.gold.filter(z => z.until > t);
    this.zoneGfx.speed = this.zoneGfx.speed.filter(z => z.until > t);
    this.zoneGfx.portal = this.zoneGfx.portal.filter(z => z.until > t);
    this.zoneGfx.meteor = this.zoneGfx.meteor.filter(z => z.warnUntil > t - 1500);
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    for (const z of this.zoneGfx.gold) {
      g.fillStyle(0xffd44d, 0.05 + 0.03 * pulse); g.fillCircle(z.x, z.y, z.r);
      g.lineStyle(3, 0xffd44d, 0.35 + 0.2 * pulse); g.strokeCircle(z.x, z.y, z.r);
    }
    for (const z of this.zoneGfx.speed) {
      g.fillStyle(0x00ffe1, 0.05); g.fillCircle(z.x, z.y, z.r);
      g.lineStyle(2, 0x00ffe1, 0.4); g.strokeCircle(z.x, z.y, z.r * (0.6 + 0.4 * pulse));
    }
    for (const p of this.zoneGfx.portal) {
      g.fillStyle(0x9b4dff, 0.25 + 0.15 * pulse); g.fillCircle(p.a.x, p.a.y, 34); g.fillCircle(p.b.x, p.b.y, 34);
      g.lineStyle(3, 0xc86bff, 0.8); g.strokeCircle(p.a.x, p.a.y, 30 + 6 * pulse); g.strokeCircle(p.b.x, p.b.y, 30 + 6 * pulse);
    }
    for (const m of this.zoneGfx.meteor) {
      const k = Math.max(0, (m.warnUntil - t) / 2200);
      g.lineStyle(4, 0xff5a3d, 0.7); g.strokeCircle(m.x, m.y, m.r * (1 - k) + 20);
      g.fillStyle(0xff5a3d, 0.12); g.fillCircle(m.x, m.y, m.r);
    }
    // BR circle
    if (eng.cfg.mode === 'br' && eng.circle.r < ARENA.WIDTH * 0.7) {
      g.lineStyle(6, 0xff5a6e, 0.9); g.strokeCircle(eng.circle.x, eng.circle.y, eng.circle.r);
      g.lineStyle(2, 0xff5a6e, 0.35); g.strokeCircle(eng.circle.x, eng.circle.y, eng.circle.nextR);
    }
  }

  // ---------- foods ----------
  private renderFoods(eng: SnakeEngine) {
    let i = 0;
    const cam = this.cam;
    const pad = 120;
    for (const f of eng.foods) {
      if (i >= this.poolFood.length) break;
      const vis = f.x > cam.scrollX - pad && f.x < cam.scrollX + cam.width + pad && f.y > cam.scrollY - pad && f.y < cam.scrollY + cam.height + pad;
      const spr = this.poolFood[i++];
      if (!vis) { if (spr.visible) spr.setVisible(false); continue; }
      const key = f.gold ? 'orb_gold' : FOOD_KEYS[f.id % FOOD_KEYS.length];
      if (spr.texture.key !== key) spr.setTexture(key);
      spr.setVisible(true).setPosition(f.x, f.y);
      const sc = (f.sz / 7) * (f.gold ? 1.25 : 1) * (0.9 + 0.12 * Math.sin((eng.time + f.id * 300) / 300));
      spr.setScale(sc);
    }
    for (; i < this.poolFood.length; i++) this.poolFood[i].setVisible(false);
  }

  // ---------- snakes ----------
  private renderSnakes(eng: SnakeEngine) {
    const seen = new Set<string>();
    for (const s of eng.snakes) {
      if (!s.alive) continue;
      seen.add(s.id);
      const distSq = (s.x - this.cam.midPoint.x) ** 2 + (s.y - this.cam.midPoint.y) ** 2;
      if (distSq > 1_600_000 && s.id !== this.world.myId) continue; // cull far snakes
      this.renderOneSnake(s, eng);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) { this.disposeVisual(v); this.visuals.delete(id); this.remoteTrail.delete(id); }
    }
  }

  private renderOneSnake(s: EngineSnake, eng: SnakeEngine) {
    let v = this.visuals.get(s.id);
    if (!v) { v = { segs: [] }; this.visuals.set(s.id, v); }
    const def = skinById(s.skin);
    const isMe = s.id === this.world.myId;
    const segR = SNAKE.BODY_BASE_R + Math.min(9, s.len * 0.05);
    const sizeTex = segR * 2.9;

    // head sprite
    if (!v.head) { v.head = this.add.image(s.x, s.y, `head_${def.id}`).setDepth(4); this.layerSnake.add(v.head); }
    v.head.setTexture(`head_${def.id}`).setPosition(s.x, s.y).setRotation(s.ang).setScale(sizeTex / 34);
    v.head.setAlpha(isMe ? 1 : 0.96);
    if (s.ghosting || s.shielded) v.head.setTint(s.ghosting ? 0x9b8cff : 0x7fe0ff); else v.head.clearTint();

    // body segments sampled along path
    const stepK = s.len > 120 ? 2 : 1;   // reduce points for huge snakes
    const need = Math.ceil(s.len / stepK) + 1;
    while (v.segs.length < need) { const nimg = this.add.image(0, 0, `seg_${def.id}_0`); this.layerSnake.add(nimg); v.segs.push(nimg); }
    while (v.segs.length > need) v.segs.pop()!.destroy();
    let idx = 0;
    for (let k = 0; k < s.len; k += stepK) {
      const bp = eng.sampleBody(s, Math.floor(k));
      if (!bp) break;
      const im = v.segs[idx++];
      im.setVisible(true).setTexture(`seg_${def.id}_${idx % Math.min(3, def.colors.length)}`)
        .setPosition(bp.x, bp.y).setScale(sizeTex / 40).setRotation(Math.atan2(s.y - bp.y, s.x - bp.x) + Math.PI / 2 * 0);
      if (s.boosting && !this.lowFx) im.setAlpha(0.85); else im.setAlpha(1);
      if (isMe && (s.feverUntil > eng.time || s.rushUntil > eng.time)) im.setTint(s.rushUntil > eng.time ? 0xffe97a : 0xffb0a0);
      else if (s.ghosting) im.setTint(0xb0a4ff), im.setAlpha(0.5);
      else im.clearTint();
    }
    for (; idx < v.segs.length; idx++) v.segs[idx].setVisible(false);

    // shield bubble
    if (s.shielded) {
      if (!(v as any)._shield) { const sh = this.add.circle(0, 0, 1, 0x7fe0ff, 0.15).setStrokeStyle(2, 0xbfeaff, 0.9).setDepth(6); this.layerSnake.add(sh); (v as any)._shield = sh; }
      const sh = (v as any)._shield as Phaser.GameObjects.Arc;
      sh.setVisible(true).setPosition(s.x, s.y).setRadius(segR * 2.4 + Math.sin(eng.time / 90) * 3);
    } else if ((v as any)._shield) (v as any)._shield.setVisible(false);

    // name tag
    if (!v.nameTag) {
      v.nameTag = this.add.text(0, 0, '', { fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', fontStyle: '800', color: '#eaf2ff', stroke: '#060a1c', strokeThickness: 4 }).setOrigin(0.5).setDepth(6);
      this.layerSnake.add(v.nameTag);
    }
    v.nameTag.setVisible(!isMe).setPosition(s.x, s.y - segR - 16).setText(`${s.name}${s.kills ? ` ☠${s.kills}` : ''}`);
    if (this.scale.width < 700) v.nameTag.setFontSize(11);
  }

  private disposeVisual(v: SnakeVisual) {
    v.head?.destroy(); v.nameTag?.destroy();
    for (const s of v.segs) s.destroy();
    ((v as any)._shield)?.destroy();
  }

  // ---------- camera ----------
  private updateCamera(me: EngineSnake | null, dtMs: number) {
    const target = me && me.alive ? { x: me.x, y: me.y } : (me ? { x: me.x, y: me.y } : { x: ARENA.WIDTH / 2, y: ARENA.HEIGHT / 2 });
    const len = me ? me.len : 10;
    const zoom = Phaser.Math.Clamp(1.15 - (len - 10) * 0.0016, 0.55, 1.15);
    const lerp = Math.min(1, dtMs / 1000 * 6.5);
    this.cam.scrollX += (target.x - this.cam.midPoint.x) * lerp;
    this.cam.scrollY += (target.y - this.cam.midPoint.y) * lerp;
    this.cam.setZoom(Phaser.Math.Linear(this.cam.zoom, zoom, Math.min(1, dtMs / 1000 * 2)));
    // fever screen tint via camera tint (works on both renderers)
    const fever = me && (me.feverUntil > this.world.engine.time || me.rushUntil > this.world.engine.time);
    (this.cam as any).setBackgroundColor?.(fever ? (me!.rushUntil > this.world.engine.time ? '#1a1400' : '#180508') : '#070a1c');
  }

  // ---------- hud ----------
  private updateHudAll(eng: SnakeEngine, me: EngineSnake | null) {
    if (!me) return;
    const lb = eng.leaderboard(10).map(x => ({ ...x, you: x.id === me.id }));
    const sorted = [...eng.snakes].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(s => s.id === me.id) + 1;
    const timeLeft = Math.max(0, eng.cfg.durationMs - eng.time);
    updateHud({
      score: me.score, kills: me.kills, len: me.len, rank, total: eng.snakes.length,
      fuel: me.boostFuel, timeLeftMs: timeLeft, lb, alive: me.alive,
      respawnIn: me.alive ? 0 : Math.max(0, SNAKE.RESPAWN_DELAY - (eng.time - me.deadAt)),
    });
    const ready = eng.time >= me.skillReadyAt;
    const remain = Math.max(0, me.skillReadyAt - eng.time);
    updateSkillCd(ready ? 0 : remain / this.skillCdMs(), ready);
    this.stats.maxLength = Math.max(this.stats.maxLength, Math.round(me.len));
    if (timeLeft <= 0 && !this.ended) this.finish(me);
  }
  private skillCdMs() { return SKILLS[this.skill]?.cooldown || 8000; }

  private finish(me: EngineSnake) {
    this.ended = true;
    const eng = this.world.engine;
    const sorted = [...eng.snakes].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(s => s.id === me.id) + 1;
    this.onEnd?.({
      score: me.score, kills: me.kills, orbs: this.stats.orbs, maxLength: this.stats.maxLength,
      maxCombo: this.stats.maxCombo, secondsAlive: Math.round((Date.now() - this.startedAt) / 1000),
      won: rank === 1, rank, total: eng.snakes.length,
    });
  }

  // count my eats for stats (offline)
  private lastEatSeen = 0;

  // ---------- minimap ----------
  private drawMini(eng: SnakeEngine, me: EngineSnake | null, dtMs: number) {
    this.mmAcc += dtMs;
    if (this.mmAcc < 100 || !this.mmCtx) return;
    this.mmAcc = 0;
    const dots = [];
    for (const s of eng.snakes) if (s.alive) dots.push({ x: s.x, y: s.y, c: s.id === this.world.myId ? '#ffffff' : skinById(s.skin).glow, me: s.id === this.world.myId });
    drawMinimap(this.mmCtx, 150, dots, { x: this.cam.scrollX, y: this.cam.scrollY, w: this.cam.width, h: this.cam.height }, ARENA.WIDTH, ARENA.HEIGHT,
      eng.cfg.mode === 'br' && eng.circle.r < ARENA.WIDTH * 0.7 ? eng.circle : null);
  }

  stopMatch() { destroyHud(); }
}
