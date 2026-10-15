// ============================================================
// Snake Rush Arena — entry point
// Boots Phaser, wires UI ↔ world (offline LocalWorld or online NetWorld)
// ============================================================
import Phaser from 'phaser';
import { MODES, type GameMode } from '@shared/gameConstants';
import { startLocalMatch, type WorldView } from './game/LocalWorld';
import { NetWorld } from './game/NetWorld';
import { SnakeEngine } from '@shared/engine';
import { applyMatchResult, saveProfile } from './game/Storage';
import { unlockAudio, Sfx } from './game/Audio';
import { buildMenu, hideMenu, showMenu, buildHud, destroyHud, showGameOver, showPause, announce, killFeed, getProfile, reloadProfile, type MenuState } from './ui/UI';
import { GameScene, type MatchResultPayload } from './ui/GameScene';

document.body.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);

let game: Phaser.Game | null = null;
let world: WorldView | null = null;
let net: NetWorld | null = null;
let lastMenu: MenuState | null = null;
let inMatch = false;

const MODE_NAMES: Record<GameMode, string> = { classic: 'Classic Arena', practice: 'Offline Practice', quick: 'Quick Match', br: 'Battle Royale', team: 'Team Battle' };

function bootPhaser() {
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-host',
    backgroundColor: '#070a1c',
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
    fps: { target: 60, forceSetTimeOut: false },
  });
}

async function startMatch(st: MenuState) {
  lastMenu = st;
  hideMenu();
  bootPhaser();
  const profile = getProfile();
  profile.name = st.name; saveProfile(profile);

  destroyHud();
  buildHud(st.skill);
  document.getElementById('hud')!.classList.add('on');
  inMatch = true;

  // pause button
  const pb = document.getElementById('btn-pause')!;
  const pauseHandler = () => {
    if (!inMatch) return;
    const sc = game!.scene.getScene('game') as GameScene;
    sc.paused = true;
    showPause(() => { sc.paused = false; }, () => quitToMenu());
  };
  pb.onclick = pauseHandler;

  let started = false;
  const beginOffline = () => {
    world = startLocalMatch({ name: st.name, skin: st.skin, skill: st.skill, mode: st.mode === 'classic' || st.mode === 'practice' ? st.mode : 'classic' });
    launchScene(st);
  };

  if (st.online) {
    announce('🌐 Đang kết nối server…');
    try {
      net = new NetWorld();
      await net.join(st.mode, st.name, st.skin, st.skill);
      announce('✅ Kết nối thành công — vào trận!');
      // Build a client-side mirror engine fed by snapshots.
      world = wrapNetWorld(net, st);
      launchScene(st);
    } catch (err) {
      console.warn('[net] join failed:', err);
      announce('⚠ Không kết nối được server — chuyển sang Offline');
      net = null;
      setTimeout(() => { world = startLocalMatch({ name: st.name, skin: st.skin, skill: st.skill, mode: 'classic' }); launchScene(st); }, 900);
    }
  } else {
    beginOffline();
  }
  void started;
}

function launchScene(st: MenuState) {
  const data = { world: world!, net, skill: st.skill };
  const old = game!.scene.getScene('game') as GameScene | null;
  if (old) { try { old.scene.stop(); } catch { /* ignore */ } game!.scene.remove('game'); }
  const sc = new GameScene();
  sc.onEnd = (r) => endMatch(r, st);
  game!.scene.add('game-tmp', sc, true, data);   // keyed add → init(data) then create()
  unlockAudio();
}

function endMatch(r: MatchResultPayload, st: MenuState) {
  inMatch = false;
  world?.dispose(); net?.dispose();
  destroyHud();
  const profile = getProfile();
  const sc = game?.scene.getScene('game') as GameScene | undefined;
  const skillsUsed = sc ? sc.skillsUsed : 0;
  const res = applyMatchResult(profile, { score: r.score, kills: r.kills, orbs: r.orbs, maxLength: r.maxLength, maxCombo: r.maxCombo, skillsUsed, secondsAlive: r.secondsAlive, won: r.won });
  if (r.won) Sfx.win();
  showGameOver({ ...r, xpGained: res.xpGained, coinsGained: res.coinsGained, leveledUp: res.leveledUp, unlockedAch: res.unlockedAch.map(a => a.name), questDone: res.questDone.length, modeName: MODE_NAMES[st.mode] },
    () => startMatch({ ...st }),
    () => quitToMenu());
}

function quitToMenu() {
  inMatch = false;
  world?.dispose(); world = null;
  net?.dispose(); net = null;
  destroyHud();
  hideMenu(); // ensure clean then rebuild
  reloadProfile();
  buildMenu(startMatch);
  showMenu();
  if (game) { game.scene.stop('game'); }
}

// ---------- online adapter: expose NetWorld through the same WorldView shape ----------
// For Phase-2 simplicity we keep a lightweight local engine that mirrors snapshot heads;
// remote bodies are reconstructed from head trails inside GameScene when offline=false.
function wrapNetWorld(nw: NetWorld, st: MenuState): WorldView {
  const cfg = MODES[st.mode];
  const mirror = new SnakeEngine(cfg);
  // pre-create snake shells; positions come from snapshots
  const me = mirror.addSnake({ id: 'me', name: st.name, bot: false, skill: st.skill, skin: st.skin });
  nw.onEvent = (kind, e) => {
    const sc = game?.scene.getScene('game') as GameScene | undefined;
    if (sc) sc.handleEvent(kind, e);
    if (kind === 'kill') killFeed(e.victim ?? '?', e.by ?? 'Arena');
    if (kind === 'announce') announce(e.msg ?? '');
  };
  nw.onDisconnected = () => { announce('⚠ Mất kết nối server'); quitToMenu(); };

  const iv = window.setInterval(() => {
    const snap = nw.lastSnap; if (!snap) return;
    // sync my predicted head into mirror engine so camera & HUD follow it
    me.x = nw.myHead.x; me.y = nw.myHead.y; me.ang = nw.myHead.ang;
    me.path.unshift(me.x, me.y); if (me.path.length > 400) me.path.length = 400;
    me.score = snap.me?.score ?? me.score;
    me.len = snap.me?.len ?? me.len;
    for (const rs of nw.remotes.values()) {
      let s = mirror.getSnake(rs.id);
      if (!s) s = mirror.addSnake({ id: rs.id, name: rs.name, bot: rs.bot, skin: rs.skin });
      const samp = nw.sampleRemote(rs.id, performance.now() - 80) || rs.samples[rs.samples.length - 1];
      if (samp) {
        s.x = samp.x; s.y = samp.y; s.ang = samp.ang; s.len = samp.len;
        s.alive = !samp.dead; s.boosting = samp.boosting;
        s.path.unshift(s.x, s.y); if (s.path.length > Math.ceil(s.len * 9) * 2 + 40) s.path.length = Math.ceil(s.len * 9) * 2 + 40;
      }
      s.score = rs.score;
    }
    for (const s of [...mirror.snakes]) if (s.id !== 'me' && !nw.remotes.has(s.id)) mirror.removeSnake(s.id);
    mirror.time = snap.time;
  }, 50);

  return {
    engine: mirror, myId: 'me', mode: st.mode, offline: false,
    setInput(angle, boost) { /* handled via nw.setInput in scene update */ void angle; void boost; },
    useSkill(skill) { nw.useSkill(skill); },
    dispose() { window.clearInterval(iv); },
  };
}

// ESC → menu during match
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && inMatch) quitToMenu();
});

// first paint: build menu immediately (fast <3s), phaser boots lazily on Play
buildMenu(startMatch);
showMenu();
const ld = document.getElementById('loading');
if (ld) { ld.style.opacity = '0'; setTimeout(() => ld.remove(), 450); }
