// ============================================================
// Local match host: wraps the shared SnakeEngine for singleplayer
// (Classic Arena offline / Practice) and exposes a uniform
// "world view" to the render scene. The same interface is used
// by the online NetAdapter, so the scene never knows the source.
// ============================================================
import { SnakeEngine, randomBotName, makeBotSkill } from '@shared/engine';
import { MODES, SKINS, type GameMode, type SkillId, type SkinId } from '@shared/gameConstants';

export interface WorldView {
  engine: SnakeEngine;
  myId: string;
  mode: GameMode;
  /** push local player's steering intent each frame */
  setInput(angle: number, boost: boolean): void;
  useSkill(skill: SkillId): void;
  dispose(): void;
  /** whether we are authoritative (offline) — net mode renders remote bodies via interpolation instead */
  offline: boolean;
}

export function startLocalMatch(opts: {
  name: string; skin: SkinId; skill: SkillId; mode: GameMode;
}): WorldView {
  const cfg = MODES[opts.mode];
  const engine = new SnakeEngine(cfg);
  const me = engine.addSnake({
    id: 'me', name: opts.name || 'You', bot: false,
    skill: opts.skill, skin: opts.skin,
  });
  const used = new Set<string>([me.name]);
  for (let i = 0; i < cfg.snakes - 1; i++) {
    const lvl = Math.random() < 0.35 ? 1 : Math.random() < 0.7 ? 2 : 3;
    const name = randomBotName(used); used.add(name);
    engine.addSnake({
      id: 'bot' + i, name, bot: true,
      skill: makeBotSkill(),
      skin: SKINS[Math.floor(Math.random() * SKINS.length)].id,
      skillLevel: lvl,
      team: opts.mode === 'team' ? (i % 2) : 0,
    });
  }

  let acc = 0, last = performance.now();
  const loop = () => {
    const now = performance.now();
    acc += Math.min(now - last, 100); last = now;
    while (acc >= 16.6) { engine.step(16.6); acc -= 16.6; }
  };
  const iv = window.setInterval(loop, 16);

  return {
    engine, myId: 'me', mode: opts.mode, offline: true,
    setInput(angle, boost) {
      me.inputAngle = angle; me.targetAng = angle; me.boosting = boost && me.alive;
    },
    useSkill(skill) { if (skill === me.skill) me.pendingSkill = skill; },
    dispose() { window.clearInterval(iv); },
  };
}
