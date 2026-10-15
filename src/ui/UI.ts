// ============================================================
// Snake Rush Arena — HTML/CSS UI layer (menu, HUD, game over)
// ============================================================
import { SKINS, SKILLS, SKILL_ORDER, LEVEL, skinById, type GameMode, type SkillId, type SkinId } from '@shared/gameConstants';
import { loadProfile, saveProfile, claimDailyReward, claimQuest, getLeaderboard, type Profile } from '../game/Storage';
import { Sfx, setAudioEnabled, isAudioEnabled, unlockAudio } from '../game/Audio';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel));

export interface MenuState { name: string; skin: SkinId; skill: SkillId; mode: GameMode; online: boolean; }

const MODE_CARDS: { id: GameMode; icon: string; title: string; desc: string; online?: boolean; soon?: boolean }[] = [
  { id: 'classic',  icon: '🏟️', title: 'Classic Arena', desc: '26 rắn · 6 phút · sinh tồn & săn mồi' },
  { id: 'practice', icon: '🤖', title: 'Offline Practice', desc: '14 bot · không cần mạng' },
  { id: 'quick',    icon: '⚡', title: 'Quick Match', desc: '3 phút · nhanh cho mobile', online: true },
  { id: 'br',       icon: '☄️', title: 'Battle Royale', desc: 'Vòng bo thu hẹp · 1 người sống sót', online: true },
  { id: 'team',     icon: '🛡️', title: 'Team Battle', desc: '2 đội đối đầu', online: true },
];

let profile: Profile = loadProfile();
let cur: MenuState = { name: profile.name, skin: profile.skin, skill: profile.skill, mode: 'classic', online: false };

export function getProfile() { return profile; }
export function reloadProfile() { profile = loadProfile(); }

function toast(msg: string, ms = 1800) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 350); }, ms);
}

function skinSwatch(id: SkinId): string {
  const s = skinById(id);
  return `background:radial-gradient(circle at 35% 35%, ${s.head}, ${s.colors[0]} 55%, ${s.colors[s.colors.length - 1]}); box-shadow:inset 0 0 12px ${s.glow}66;`;
}

// ================= MENU =================
export function buildMenu(onPlay: (st: MenuState) => void) {
  const root = $('#ui-root')!;
  const daily = claimDailyReward(profile);
  if (daily.ok) setTimeout(() => toast(`🎁 Thưởng đăng nhập ngày thứ ${profile.loginStreak}: +${daily.amount} xu!`), 600);

  root.innerHTML = `
  <div class="screen dim on" id="menu">
    <div class="wrap glass">
      <div id="logo">SNAKE RUSH<small>A R E N A</small></div>

      <div class="statbar">
        <span>👤 <b id="p-level">Lv.${profile.level}</b></span>
        <span class="coin-pill">🪙 <b id="p-coins">${profile.coins}</b></span>
        <span>⭐ XP <b id="p-xp">${profile.xp}/${LEVEL.XP_PER_LEVEL(profile.level)}</b></span>
        <span>💀 Hạ gục <b id="p-kills">${profile.totalKills}</b></span>
        <span>🏆 Kỷ lục <b id="p-best">${profile.bestScore.toLocaleString()}</b></span>
      </div>
      <div style="max-width:420px;margin:8px auto 0"><div class="quest" style="border:none;padding:0">
        <span style="font-size:11px;color:#7fa8ff">LV</span>
        <div class="bar"><i style="width:${Math.min(100, profile.xp / LEVEL.XP_PER_LEVEL(profile.level) * 100)}%"></i></div>
      </div></div>

      <div class="row" style="margin-top:18px">
        <div class="col" style="flex:1.6">
          <div class="sect-title">Chế độ chơi</div>
          <div class="row" id="mode-row">${MODE_CARDS.map(m => `
            <div class="mode-card ${m.id === cur.mode ? 'sel' : ''}" data-mode="${m.id}" ${m.online ? 'data-online="1"' : ''}>
              <b>${m.icon} ${m.title}</b><span>${m.desc}${m.online ? ' · cần server' : ''}</span>
            </div>`).join('')}
          </div>

          <div class="sect-title">Tên & kỹ năng</div>
          <div class="row">
            <input class="txt" id="inp-name" maxlength="14" placeholder="Tên của bạn" value="${cur.name.replace(/"/g, '')}" />
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" id="skill-row">
            ${SKILL_ORDER.map(k => `<div class="chip ${cur.skill === k ? 'sel' : ''}" data-skill="${k}" title="${SKILLS[k].desc}">${SKILLS[k].icon} ${SKILLS[k].name} <span style="color:#7fa8ff;font-size:11px">${SKILLS[k].cooldown / 1000}s</span></div>`).join('')}
          </div>

          <div class="sect-title">Skin (chỉ thay đổi ngoại hình — không pay-to-win)</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;padding-bottom:6px" id="skin-row">
            ${SKINS.map(s => {
              const owned = profile.ownedSkins.includes(s.id);
              return `<div class="skin-cell ${cur.skin === s.id ? 'sel' : ''} ${owned ? '' : 'locked'}" data-skin="${s.id}" title="${s.name}">
                <div style="width:44px;height:44px;border-radius:50%;${skinSwatch(s.id)}"></div>
                ${owned ? '' : `<div class="price">🪙 ${s.price}</div>`}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="col" style="flex:1;display:flex;flex-direction:column;gap:14px">
          <div>
            <div class="sect-title" style="margin-top:0">🏅 Bảng xếp hạng</div>
            <div class="lb-tabs" id="lb-tabs">
              <div class="chip sel" data-r="day">Ngày</div><div class="chip" data-r="week">Tuần</div><div class="chip" data-r="all">All-time</div>
            </div>
            <ul class="lb-list" id="lb-list"></ul>
          </div>
          <div>
            <div class="sect-title">📋 Nhiệm vụ hôm nay</div>
            <div id="quest-list"></div>
          </div>
        </div>
      </div>

      <div id="play-area">
        <button class="btn secondary" id="btn-sound" style="padding:14px 18px">${isAudioEnabled() ? '🔊' : '🔇'}</button>
        <button class="btn" id="btn-play">▶ PLAY</button>
        <button class="btn secondary" id="btn-online" style="padding:14px 18px" title="Chơi online qua server Colyseus">${cur.online ? '🌐 Online' : '💾 Offline'}</button>
      </div>
      <div style="text-align:center;font-size:11.5px;color:#5f7bb0;margin-top:10px">Chuột/chạm: lái · Giữ chuột trái / SPACE: tăng tốc · Q hoặc nút: kỹ năng · ESC: menu</div>
    </div>
  </div>`;

  const renderLb = (range: 'day' | 'week' | 'all') => {
    const list = getLeaderboard(range);
    $('#lb-list')!.innerHTML = list.length
      ? list.slice(0, 10).map((e, i) => `<li><span class="rk">${i + 1}</span><span style="flex:1;margin-left:6px">${esc(e.name)}</span><span style="color:#ffd44d">${e.score.toLocaleString()}</span></li>`).join('')
      : '<li style="color:#5f7bb0;justify-content:center">Chưa có điểm — chơi ngay!</li>';
  };
  renderLb('day');

  const renderQuests = () => {
    $('#quest-list')!.innerHTML = profile.quests.defs.map((q, i) => {
      const p = Math.min(1, profile.quests.progress[i] / q.target);
      const done = p >= 1, claimed = profile.quests.claimed[i];
      return `<div class="quest"><span style="flex:1.2">${q.text}<br><span style="color:#7fa8ff;font-size:11px">${Math.min(profile.quests.progress[i], q.target).toLocaleString()}/${q.target.toLocaleString()}</span></span>
        <div class="bar"><i style="width:${p * 100}%"></i></div>
        ${claimed ? '<span style="color:#5dff8f">✔</span>' : done ? `<button class="btn gold" style="padding:4px 10px;font-size:12px" data-claim="${i}">Nhận 🪙${q.reward}</button>` : `<span class="qrw">🪙${q.reward}</span>`}
      </div>`;
    }).join('');
    $$('#quest-list [data-claim]').forEach(b => b.addEventListener('click', () => {
      const got = claimQuest(profile, Number((b as HTMLElement).dataset.claim));
      if (got) { Sfx.buy(); toast(`✅ Hoàn thành nhiệm vụ: +${got} xu`); refreshHead(); renderQuests(); }
    }));
  };
  renderQuests();

  // events
  $$('#mode-row .mode-card').forEach(c => c.addEventListener('click', () => {
    cur.mode = (c as HTMLElement).dataset.mode as GameMode;
    cur.online = (c as HTMLElement).dataset.online === '1';
    $$('#mode-row .mode-card').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    $('#btn-online')!.textContent = cur.online ? '🌐 Online' : '💾 Offline';
    Sfx.ui();
  }));
  $$('#skill-row .chip').forEach(c => c.addEventListener('click', () => {
    cur.skill = (c as HTMLElement).dataset.skill as SkillId;
    $$('#skill-row .chip').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); Sfx.ui();
  }));
  $$('#skin-row .skin-cell').forEach(c => c.addEventListener('click', () => {
    const id = (c as HTMLElement).dataset.skin as SkinId;
    const def = skinById(id);
    if (!profile.ownedSkins.includes(id)) {
      if (profile.coins >= def.price) {
        profile.coins -= def.price; profile.ownedSkins.push(id); saveProfile(profile);
        Sfx.buy(); toast(`🎉 Mở khóa skin ${def.name}!`);
        buildMenu(onPlay); return;
      } else { Sfx.deny(); toast(`Cần 🪙${def.price} xu — kiếm xu bằng cách chơi!`); return; }
    }
    cur.skin = id; profile.skin = id; saveProfile(profile);
    $$('#skin-row .skin-cell').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); Sfx.ui();
  }));
  $$('#lb-tabs .chip').forEach(c => c.addEventListener('click', () => {
    $$('#lb-tabs .chip').forEach(x => x.classList.remove('sel')); c.classList.add('sel');
    renderLb((c as HTMLElement).dataset.r as any); Sfx.ui();
  }));
  $('#inp-name')!.addEventListener('input', e => { cur.name = (e.target as HTMLInputElement).value; profile.name = cur.name; saveProfile(profile); refreshHead(); });
  $('#btn-sound')!.addEventListener('click', () => {
    setAudioEnabled(!isAudioEnabled());
    $('#btn-sound')!.textContent = isAudioEnabled() ? '🔊' : '🔇';
    if (isAudioEnabled()) { unlockAudio(); Sfx.ui(); }
  });
  $('#btn-online')!.addEventListener('click', () => {
    cur.online = !cur.online;
    $('#btn-online')!.textContent = cur.online ? '🌐 Online' : '💾 Offline';
    Sfx.ui();
    if (cur.online) toast('Sẽ kết nối server ws://…:2567 — đảm bảo đã chạy `npm run server:dev`');
  });
  $('#btn-play')!.addEventListener('click', () => {
    unlockAudio();
    cur.name = ($('#inp-name') as HTMLInputElement).value.trim() || profile.name;
    Sfx.ui();
    onPlay({ ...cur });
  });
}

function refreshHead() {
  const c = $('#p-coins'); if (c) c.textContent = String(profile.coins);
  const l = $('#p-level'); if (l) l.textContent = `Lv.${profile.level}`;
  const x = $('#p-xp'); if (x) x.textContent = `${profile.xp}/${LEVEL.XP_PER_LEVEL(profile.level)}`;
  const k = $('#p-kills'); if (k) k.textContent = String(profile.totalKills);
  const b = $('#p-best'); if (b) b.textContent = profile.bestScore.toLocaleString();
}

export function hideMenu() { const m = $('#menu'); if (m) m.classList.remove('on'); }
export function showMenu() { const m = $('#menu'); if (m) m.classList.add('on'); }

// ================= HUD =================
export function buildHud(skill: SkillId) {
  const root = $('#ui-root')!;
  root.insertAdjacentHTML('beforeend', `
  <div id="hud">
    <div class="hud-tl glass">
      <div class="hud-score neon-text" id="h-score">0</div>
      <div class="hud-sub"><span id="h-kills">0</span> hạ gục · dài <span id="h-len">10</span> · <span id="h-rank">#?</span></div>
    </div>
    <div id="time-left">6:00</div>
    <button class="btn secondary" id="btn-pause">☰</button>
    <div class="hud-tr"><div class="lb-mini glass"><ol id="h-lb"></ol></div></div>
    <div id="combo-wrap"><div id="combo-num">x0</div><div id="combo-tier"></div></div>
    <div id="announce"></div>
    <div id="killfeed"></div>
    <canvas id="minimap" width="150" height="150"></canvas>
    <div id="fuel-wrap" class="glass" style="padding:8px 10px;background:rgba(10,14,35,.6)">
      <div class="hud-sub">⚡ Năng lượng tăng tốc</div><div id="fuel-bar"><i></i></div>
    </div>
    <div id="skill-bar">
      <button class="skill-btn ready" id="sk-main"><span>${SKILLS[skill].icon}</span><div class="cd"></div></button>
    </div>
    <button class="btn" id="boost-btn">TỐC<br>ĐỘ</button>
    <div id="death-overlay"><div style="font-size:22px;font-weight:800;color:#ffb3c1">💀 Bạn đã bị tiêu diệt!</div><div id="respawn-count">3</div><div style="font-size:13px;color:#9dbcf5">Cơ thể biến thành năng lượng — quay lại sớm!</div></div>
  </div>`);
  const sk = $('#sk-main')!;
  sk.title = `${SKILLS[skill].name}: ${SKILLS[skill].desc}`;
  return { skill };
}

export function destroyHud() { const h = $('#hud'); if (h) h.remove(); }

const hudCache: Record<string, number | string> = {};
export function updateHud(d: { score: number; kills: number; len: number; rank: number; total: number; fuel: number; timeLeftMs: number; lb: { name: string; score: number; you?: boolean }[]; alive: boolean; respawnIn: number }) {
  setText('#h-score', d.score.toLocaleString());
  setText('#h-kills', String(d.kills));
  setText('#h-len', String(Math.round(d.len)));
  setText('#h-rank', `#${d.rank}/${d.total}`);
  const mm = Math.max(0, Math.floor(d.timeLeftMs / 60000)), ss = Math.max(0, Math.floor(d.timeLeftMs / 1000) % 60);
  setText('#time-left', `${mm}:${String(ss).padStart(2, '0')}`);
  const fb = $('#fuel-bar > i') as HTMLElement | null; if (fb) fb.style.width = `${Math.round(d.fuel)}%`;
  const lbEl = $('#h-lb');
  if (lbEl && d.lb.length) {
    const html = d.lb.slice(0, 10).map(s => `<li class="${s.you ? 'me' : ''}">${esc(s.name)} — ${s.score.toLocaleString()}</li>`).join('');
    if (html !== hudCache.__lb) { hudCache.__lb = html; lbEl.innerHTML = html; }
  }
  const dov = $('#death-overlay')!;
  if (dov) {
    dov.classList.toggle('on', !d.alive);
    if (!d.alive) setText('#respawn-count', String(Math.max(1, Math.ceil(d.respawnIn / 1000))));
  }
}
function setText(sel: string, v: string) { if (hudCache[sel] === v) return; hudCache[sel] = v; const el = $(sel); if (el) el.textContent = v; }

export function showCombo(n: number, tier: 'combo' | 'fever' | 'rush') {
  const cn = $('#combo-num')!, ct = $('#combo-tier')!;
  if (!cn) return;
  cn.textContent = `COMBO x${n}`;
  cn.style.opacity = '1';
  cn.classList.remove('pop'); void cn.offsetWidth; cn.classList.add('pop');
  ct.style.opacity = '1';
  ct.textContent = tier === 'fever' ? '🔥 FEVER! điểm x1.5' : tier === 'rush' ? '✨ GOLD RUSH! điểm x2.5' : 'ăn liên tiếp!';
  (clearTimeout as any)((showCombo as any)._t);
  (showCombo as any)._t = window.setTimeout(() => { cn.style.opacity = '0'; ct.style.opacity = '0'; }, 1600);
}

export function announce(msg: string) {
  const a = $('#announce'); if (!a) return;
  a.textContent = msg; a.style.opacity = '1';
  (clearTimeout as any)((announce as any)._t);
  (announce as any)._t = setTimeout(() => a.style.opacity = '0', 3200);
}

export function killFeed(victim: string, by: string) {
  const kf = $('#killfeed'); if (!kf) return;
  const div = document.createElement('div');
  div.innerHTML = `💀 <b>${esc(by)}</b> ⚔ ${esc(victim)}`;
  kf.prepend(div);
  while (kf.children.length > 5) kf.lastElementChild?.remove();
  setTimeout(() => { div.style.transition = 'opacity .5s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 600); }, 4000);
}

export function updateSkillCd(frac: number, ready: boolean) {
  const btn = $('#sk-main'); if (!btn) return;
  const cd = btn.querySelector('.cd') as HTMLElement;
  cd.style.setProperty('--p', `${Math.round(frac * 100)}%`);
  btn.classList.toggle('ready', ready);
}

export function drawMinimap(ctx2: CanvasRenderingContext2D, size: number, dots: { x: number; y: number; c: string; me?: boolean }[], view: { x: number; y: number; w: number; h: number }, arenaW: number, arenaH: number, circle?: { x: number; y: number; r: number } | null) {
  ctx2.clearRect(0, 0, size, size);
  ctx2.fillStyle = 'rgba(8,12,30,.4)'; ctx2.fillRect(0, 0, size, size);
  if (circle) {
    const sx = size / arenaW, sy = size / arenaH;
    ctx2.strokeStyle = 'rgba(255,90,110,.8)'; ctx2.lineWidth = 1.5;
    ctx2.beginPath(); ctx2.arc(circle.x * sx, circle.y * sy, circle.r * sx, 0, Math.PI * 2); ctx2.stroke();
  }
  const sx = size / arenaW, sy = size / arenaH;
  for (const d of dots) {
    ctx2.fillStyle = d.c;
    ctx2.beginPath(); ctx2.arc(d.x * sx, d.y * sy, d.me ? 3.5 : 2.2, 0, Math.PI * 2); ctx2.fill();
  }
  ctx2.strokeStyle = 'rgba(120,170,255,.5)'; ctx2.lineWidth = 1;
  ctx2.strokeRect(view.x * sx, view.y * sy, view.w * sx, view.h * sy);
}

// ================= GAME OVER =================
export interface GoStats { score: number; kills: number; orbs: number; maxLength: number; maxCombo: number; secondsAlive: number; rank: number; total: number; won: boolean; xpGained: number; coinsGained: number; leveledUp: boolean; unlockedAch: string[]; questDone: number; modeName: string; }
export function showGameOver(st: GoStats, onAgain: () => void, onMenu: () => void) {
  const root = $('#ui-root')!;
  root.insertAdjacentHTML('beforeend', `
  <div class="screen dim on" id="gameover">
    <div class="box glass">
      <div style="font-size:34px;font-weight:900" class="neon-text">${st.won ? '🏆 CHIẾN THẮNG!' : '⚔ KẾT THÚC TRẬN'}</div>
      <div style="color:#9dbcf5;margin-top:4px">${st.modeName} · Hạng <b style="color:#fff">#${st.rank}</b>/${st.total}</div>
      <div class="go-stats">
        <div class="go-stat"><b>${st.score.toLocaleString()}</b><span>Điểm</span></div>
        <div class="go-stat"><b>${st.kills}</b><span>Hạ gục</span></div>
        <div class="go-stat"><b>${st.orbs}</b><span>Năng lượng</span></div>
        <div class="go-stat"><b>${st.maxLength}</b><span>Dài nhất</span></div>
        <div class="go-stat"><b>x${st.maxCombo}</b><span>Combo max</span></div>
        <div class="go-stat"><b>${fmtTime(st.secondsAlive)}</b><span>Sống sót</span></div>
      </div>
      <div class="reward-line">+<b>${st.xpGained} XP</b> ${st.leveledUp ? '· 🎉 LÊN CẤP!' : ''} &nbsp; +<b>${st.coinsGained} xu</b>${st.questDone ? ` · ✅ ${st.questDone} nhiệm vụ!` : ''}</div>
      ${st.unlockedAch.length ? `<div class="reward-line" style="color:#5dff8f">🏅 Thành tích: ${st.unlockedAch.join(', ')}</div>` : ''}
      <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
        <button class="btn" id="go-again" style="padding:14px 40px">▶ CHƠI NGAY</button>
        <button class="btn secondary" id="go-menu" style="padding:14px 26px">MENU</button>
      </div>
    </div>
  </div>`);
  $('#go-again')!.addEventListener('click', () => { removeGo(); Sfx.ui(); onAgain(); });
  $('#go-menu')!.addEventListener('click', () => { removeGo(); Sfx.ui(); onMenu(); });
}
function removeGo() { const g = $('#gameover'); if (g) g.remove(); }
export function hideGameOver() { removeGo(); }
function fmtTime(sec: number) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`; }

// pause overlay
export function showPause(onResume: () => void, onQuit: () => void) {
  const root = $('#ui-root')!;
  root.insertAdjacentHTML('beforeend', `
  <div class="screen dim on" id="pause-screen">
    <div class="box glass" style="padding:30px;text-align:center;width:min(380px,90vw)">
      <div style="font-size:28px;font-weight:900" class="neon-text">⏸ TẠM DỪNG</div>
      <div style="margin-top:18px;display:flex;flex-direction:column;gap:10px">
        <button class="btn" id="p-resume" style="padding:12px">TIẾP TỤC</button>
        <button class="btn danger" id="p-quit" style="padding:12px">THOÁT VỀ MENU</button>
      </div>
    </div>
  </div>`);
  $('#p-resume')!.addEventListener('click', () => { $('#pause-screen')?.remove(); onResume(); });
  $('#p-quit')!.addEventListener('click', () => { $('#pause-screen')?.remove(); onQuit(); });
}

export function esc(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }
