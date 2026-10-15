// ============================================================
// Online world adapter (Colyseus client). Server is authoritative:
// client only sends input {angle, boost, skill}; renders snapshots
// with interpolation delay for remote snakes and prediction for me.
// ============================================================
import { Client } from 'colyseus';
import { NET, type GameMode, type SkillId, type SkinId, type ServerSnap } from '@shared/gameConstants';

export interface RemoteSample { t: number; x: number; y: number; ang: number; len: number; boosting: boolean; dead: boolean }
export interface RemoteState {
  id: string; name: string; skin: string; bot: boolean; team: number;
  samples: RemoteSample[];        // ring buffer for interpolation
  score: number; kills: number;
  x: number; y: number; ang: number; len: number; boosting: boolean; dead: boolean;
}

const SERVER_URL = (import.meta as any).env?.VITE_SERVER_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;

export class NetWorld {
  client = new Client(SERVER_URL);
  room: any = null;
  remotes = new Map<string, RemoteState>();
  lastSnap: ServerSnap | null = null;
  myHead = { x: 0, y: 0, ang: 0 };   // client-side prediction
  connected = false;
  onEvent?: (kind: string, data: any) => void;
  onDisconnected?: () => void;
  private sendAcc = 0;

  async join(mode: GameMode, name: string, skin: SkinId, skill: SkillId): Promise<void> {
    this.room = await this.client.joinOrCreate('snake_room', { name, skin, skill, mode });
    this.connected = true;
    this.room.onMessage('snap', (snap: ServerSnap) => this.applySnap(snap));
    this.room.onMessage('ev', (e: any) => this.onEvent?.(e.kind, e));
    this.room.onLeave?.(() => { this.connected = false; this.onDisconnected?.(); });
  }

  private applySnap(snap: ServerSnap) {
    this.lastSnap = snap;
    const now = performance.now();
    if (snap.me) this.myHead = { x: snap.me.x, y: snap.me.y, ang: snap.me.ang };
    const seen = new Set<string>();
    for (const s of snap.snakes) {
      if (s.id === snap.me?.id) continue;
      seen.add(s.id);
      let r = this.remotes.get(s.id);
      if (!r) {
        r = { id: s.id, name: s.name, skin: s.skin, bot: s.bot, team: s.team ?? 0,
              samples: [], score: 0, kills: 0, x: s.x, y: s.y, ang: s.ang, len: s.len, boosting: false, dead: true };
        this.remotes.set(s.id, r);
      }
      r.name = s.name; r.skin = s.skin; r.score = s.score; r.dead = s.dead;
      r.samples.push({ t: now, x: s.x, y: s.y, ang: s.ang, len: s.len, boosting: s.boosts, dead: s.dead });
      if (r.samples.length > 30) r.samples.shift();
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remotes.delete(id);
  }

  /** interpolated state of a remote snake at render time */
  sampleRemote(id: string, renderTime: number): RemoteSample | null {
    const r = this.remotes.get(id);
    if (!r || r.samples.length === 0) return null;
    const s = r.samples;
    if (renderTime >= s[s.length - 1].t) return s[s.length - 1];
    for (let i = 1; i < s.length; i++) {
      if (s[i].t >= renderTime) {
        const a = s[i - 1], b = s[i];
        const t = (renderTime - a.t) / Math.max(1, b.t - a.t);
        let da = b.ang - a.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        return { t: renderTime, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
                 ang: a.ang + da * t, len: a.len + (b.len - a.len) * t, boosting: b.boosting, dead: b.dead };
      }
    }
    return s[0];
  }

  setInput(angle: number, boost: boolean, dtMs: number) {
    // local prediction so my head feels instant
    const speed = boost ? 282 : 168;
    this.myHead.ang = angle;
    this.myHead.x += Math.cos(angle) * speed * dtMs / 1000;
    this.myHead.y += Math.sin(angle) * speed * dtMs / 1000;
    this.sendAcc += dtMs;
    if (this.sendAcc >= NET.INPUT_EVERY_MS && this.room?.send) {
      this.sendAcc = 0;
      try { this.room.send({ t: 'input', angle, boost }); } catch { /* ignore */ }
    }
  }
  useSkill(skill: SkillId) { this.room?.send?.({ t: 'input', angle: this.myHead.ang, boost: false, skill }); }
  respawn() { this.room?.send?.({ t: 'respawn' }); }
  dispose() { try { this.room?.leave?.(); } catch { /* ignore */ } this.connected = false; }
}
