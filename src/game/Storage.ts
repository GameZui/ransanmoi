// ============================================================
// Player progress persistence (localStorage) — Phase 3 systems:
// coins, XP, level, skins, daily quests, achievements, stats,
// daily rewards, local leaderboards.
// ============================================================
import { LEVEL, SKINS, type SkinId, type SkillId } from '@shared/gameConstants';

export interface QuestDef { id: string; text: string; target: number; reward: number; metric: QuestMetric }
export type QuestMetric = 'score' | 'kills' | 'orbs' | 'length' | 'combo' | 'games' | 'skills';

const QUEST_POOL: QuestDef[] = [
  { id: 'q_score_5k',   text: 'Đạt 5,000 điểm trong một trận',      target: 5000,  reward: 120, metric: 'score' },
  { id: 'q_score_10k',  text: 'Đạt 10,000 điểm trong một trận',     target: 10000, reward: 300, metric: 'score' },
  { id: 'q_kills_3',    text: 'Hạ gục 3 rắn trong một ngày',        target: 3,     reward: 150, metric: 'kills' },
  { id: 'q_kills_8',    text: 'Hạ gục 8 rắn trong một ngày',        target: 8,     reward: 350, metric: 'kills' },
  { id: 'q_orbs_150',   text: 'Ăn 150 viên năng lượng trong ngày',  target: 150,   reward: 140, metric: 'orbs' },
  { id: 'q_len_60',     text: 'Dài tới 60 khúc trong một trận',     target: 60,    reward: 200, metric: 'length' },
  { id: 'q_combo_15',   text: 'Đạt combo x15 trong một trận',       target: 15,    reward: 220, metric: 'combo' },
  { id: 'q_games_3',    text: 'Chơi 3 trận trong ngày',             target: 3,     reward: 100, metric: 'games' },
  { id: 'q_skill_10',   text: 'Dùng 10 kỹ năng trong ngày',         target: 10,    reward: 130, metric: 'skills' },
];

export interface Achievement { id: string; name: string; desc: string; target: number; reward: number }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'a_kill_1',   name: 'First Blood',    desc: 'Hạ gục 1 con rắn',        target: 1,    reward: 50 },
  { id: 'a_kill_25',  name: 'Slayer',         desc: 'Hạ gục 25 con rắn',       target: 25,   reward: 250 },
  { id: 'a_kill_100', name: 'Apex Predator',  desc: 'Hạ gục 100 con rắn',      target: 100,  reward: 900 },
  { id: 'a_score_50k',name: 'High Scorer',    desc: 'Tổng điểm 50,000',        target: 50000,reward: 300 },
  { id: 'a_len_100',  name: 'Big Boy',        desc: 'Dài 100 khúc trong 1 trận',target: 100, reward: 400 },
];

export interface Profile {
  name: string;
  skin: SkinId;
  skill: SkillId;
  coins: number;
  xp: number;
  level: number;
  ownedSkins: SkinId[];
  totalKills: number;
  totalScore: number;
  bestScore: number;
  bestLength: number;
  gamesPlayed: number;
  quests: { date: string; defs: QuestDef[]; progress: number[]; claimed: boolean[] };
  achClaimed: string[];
  lastLogin: string;
  loginStreak: number;
  streakRewarded: string; // date of claimed streak reward
}

const KEY = 'snake_rush_profile_v1';
const LB_KEY = 'snake_rush_leaderboard_v1';

const today = () => new Date().toISOString().slice(0, 10);

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function defaultProfile(): Profile {
  const seed = today().split('-').reduce((x, y) => x + Number(y), 0);
  const qs = seededShuffle(QUEST_POOL, seed).slice(0, 3);
  return {
    name: 'Player' + Math.floor(Math.random() * 900 + 100),
    skin: 'neon', skill: 'dash',
    coins: 0, xp: 0, level: 1,
    ownedSkins: ['neon', 'candy'],
    totalKills: 0, totalScore: 0, bestScore: 0, bestLength: 0, gamesPlayed: 0,
    quests: { date: today(), defs: qs, progress: [0, 0, 0], claimed: [false, false, false] },
    achClaimed: [], lastLogin: '', loginStreak: 0, streakRewarded: '',
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const p = { ...defaultProfile(), ...JSON.parse(raw) } as Profile;
    // roll daily quests
    if (p.quests.date !== today()) {
      const seed = today().split('-').reduce((x, y) => x + Number(y), 0);
      p.quests = { date: today(), defs: seededShuffle(QUEST_POOL, seed).slice(0, 3), progress: [0, 0, 0], claimed: [false, false, false] };
    }
    // login streak
    if (p.lastLogin !== today()) {
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      p.loginStreak = p.lastLogin === y ? p.loginStreak + 1 : 1;
      p.lastLogin = today();
    }
    saveProfile(p);
    return p;
  } catch { return defaultProfile(); }
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export function claimDailyReward(p: Profile): { ok: boolean; amount: number } {
  if (p.streakRewarded === today()) return { ok: false, amount: 0 };
  const amount = 60 + Math.min(p.loginStreak, 7) * 40;
  p.coins += amount; p.streakRewarded = today();
  saveProfile(p);
  return { ok: true, amount };
}

export interface MatchResult { score: number; kills: number; orbs: number; maxLength: number; maxCombo: number; skillsUsed: number; secondsAlive: number; won: boolean }

export function applyMatchResult(p: Profile, r: MatchResult): { xpGained: number; coinsGained: number; leveledUp: boolean; unlockedAch: Achievement[]; questDone: number[] } {
  const xpGained = Math.round(r.score / 10 + r.kills * 25 + r.secondsAlive / 4 + (r.won ? 200 : 0));
  const coinsGained = Math.round(r.score / 100 + r.kills * 8 + (r.won ? 60 : 0));
  p.xp += xpGained; p.coins += coinsGained;
  let leveledUp = false;
  while (p.level < LEVEL.MAX_LEVEL && p.xp >= LEVEL.XP_PER_LEVEL(p.level)) { p.xp -= LEVEL.XP_PER_LEVEL(p.level); p.level++; leveledUp = true; }
  p.totalKills += r.kills; p.totalScore += r.score; p.gamesPlayed++;
  p.bestScore = Math.max(p.bestScore, r.score);
  p.bestLength = Math.max(p.bestLength, r.maxLength);

  const questDone: number[] = [];
  p.quests.defs.forEach((q, i) => {
    const inc = q.metric === 'score' ? r.score : q.metric === 'kills' ? r.kills : q.metric === 'orbs' ? r.orbs
      : q.metric === 'length' ? r.maxLength : q.metric === 'combo' ? r.maxCombo : q.metric === 'games' ? 1 : r.skillsUsed;
    const before = p.quests.progress[i];
    p.quests.progress[i] = q.metric === 'score' || q.metric === 'length' || q.metric === 'combo'
      ? Math.max(before, inc) : before + inc;
    if (!q ? false : before < q.target && p.quests.progress[i] >= q.target) questDone.push(i);
  });

  const unlockedAch: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achClaimed.includes(a.id)) continue;
    const val = a.id.startsWith('a_kill') ? p.totalKills : a.id === 'a_score_50k' ? p.totalScore : p.bestLength;
    if (val >= a.target) { unlockedAch.push(a); p.achClaimed.push(a.id); p.coins += a.reward; }
  }
  saveProfile(p);
  pushLocalLeaderboard({ name: p.name, score: r.score, mode: 'classic', date: today(), level: p.level });
  return { xpGained, coinsGained, leveledUp, unlockedAch, questDone };
}

export function buySkin(p: Profile, skinId: SkinId): boolean {
  const def = SKINS.find(s => s.id === skinId);
  if (!def || p.ownedSkins.includes(skinId) || p.coins < def.price) return false;
  p.coins -= def.price; p.ownedSkins.push(skinId);
  saveProfile(p);
  return true;
}

export function claimQuest(p: Profile, idx: number): number {
  const q = p.quests.defs[idx];
  if (!q || p.quests.claimed[idx] || p.quests.progress[idx] < q.target) return 0;
  p.quests.claimed[idx] = true; p.coins += q.reward;
  saveProfile(p);
  return q.reward;
}

// ---------- local leaderboard entries (day/week/all merged client-side) ----------
export interface LbEntry { name: string; score: number; mode: string; date: string; level: number }
export function pushLocalLeaderboard(e: LbEntry) {
  try {
    const all: LbEntry[] = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
    all.push(e);
    all.sort((a, b) => b.score - a.score);
    localStorage.setItem(LB_KEY, JSON.stringify(all.slice(0, 100)));
  } catch { /* ignore */ }
}
export function getLeaderboard(range: 'day' | 'week' | 'all'): LbEntry[] {
  try {
    const all: LbEntry[] = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
    const now = Date.now();
    return all.filter(e => {
      if (range === 'all') return true;
      const d = new Date(e.date).getTime();
      return range === 'day' ? now - d < 36 * 3600e3 : now - d < 8 * 864e5;
    }).slice(0, 10);
  } catch { return []; }
}
