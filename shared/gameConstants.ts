// ============================================================
// Snake Rush Arena - Shared constants (frontend + backend)
// ============================================================

export const ARENA = {
  WIDTH: 4200,
  HEIGHT: 4200,
  GRID: 120,            // background grid spacing
  WALL_MARGIN: 30,
};

export const FOOD = {
  BASE_COUNT: 620,          // ambient orbs at match start
  GOLD_VALUE: 5,            // score of a golden orb
  GOLD_CHANCE: 0.07,
  BASE_VALUE: 1,
  SIZE_MIN: 5,
  SIZE_MAX: 8,
  MAGNET_RADIUS: 130,       // skill magnet pull radius
  EAT_DIST: 16,
};

export const SNAKE = {
  START_LENGTH: 10,         // number of body segments
  SEG_SPACING: 9,           // distance between sampled path points
  BASE_SPEED: 168,          // px/s
  BOOST_SPEED: 282,         // px/s
  TURN_RATE: 4.6,           // rad/s base
  HEAD_RADIUS: 13,
  BODY_BASE_R: 9,
  MAX_GROWTH: 260,          // segments cap
  DECAY_AFTER_KILL_MS: 9000,
  DECAY_STEP_MS: 450,       // lose 1 segment per this while over cap
  RESPAWN_DELAY: 1600,
  INVULN_MS: 1500,
  BOOST_DRAIN_LEN: 3.2,     // length lost per second while boosting (min length 6)
  MIN_LENGTH: 6,
};

export const SCORE = {
  PER_ORB: 10,
  GOLD_MULTIPLIER: 3,
  KILL_BASE: 120,
  COMBO_WINDOW_MS: 2600,
  FEVER_AT: 10,
  FEVER_MULT: 1.5,
  FEVER_DURATION: 6000,
  GOLDRUSH_AT: 20,
  GOLDRUSH_MULT: 2.5,
  GOLDRUSH_DURATION: 8000,
};

export type SkillId = 'dash' | 'shield' | 'magnet' | 'ghost' | 'shockwave';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  desc: string;
  cooldown: number;   // ms
  duration: number;   // ms (0 = instant)
}

export const SKILLS: Record<SkillId, SkillDef> = {
  dash:      { id: 'dash',      name: 'Dash',      icon: '⚡', desc: 'Tăng tốc cực mạnh trong 0.6s, không tốn độ dài', cooldown: 7000,  duration: 600 },
  shield:    { id: 'shield',    name: 'Shield',    icon: '🛡', desc: 'Khiên bảo vệ xuyên thân đối thủ trong 1.5s',    cooldown: 12000, duration: 1500 },
  magnet:    { id: 'magnet',    name: 'Magnet',    icon: '🧲', desc: 'Hút năng lượng xung quanh trong 4s',             cooldown: 10000, duration: 4000 },
  ghost:     { id: 'ghost',     name: 'Ghost',     icon: '👻', desc: 'Xuyên qua mọi thân rắn trong 2.5s',              cooldown: 14000, duration: 2500 },
  shockwave: { id: 'shockwave', name: 'Shockwave', icon: '💥', desc: 'Đẩy văng đối thủ & mồi ở gần, sát thương nhẹ',   cooldown: 11000, duration: 0 },
};
export const SKILL_ORDER: SkillId[] = ['dash', 'shield', 'magnet', 'ghost', 'shockwave'];

export type SkinId = 'neon' | 'dragon' | 'cyber' | 'galaxy' | 'fire' | 'ice' | 'gold' | 'toxic' | 'ocean' | 'candy';

export interface SkinDef {
  id: SkinId;
  name: string;
  price: number;        // coins (0 = free)
  colors: string[];     // body gradient stops
  glow: string;         // glow color
  head: string;         // head color
}

export const SKINS: SkinDef[] = [
  { id: 'neon',   name: 'Neon Viper',  price: 0,    colors: ['#00ffcc', '#00b3ff'], glow: '#00ffe1', head: '#eaffff' },
  { id: 'candy',  name: 'Candy Pop',   price: 0,    colors: ['#ff9ad5', '#ffd86b'], glow: '#ff7be0', head: '#fff3d6' },
  { id: 'toxic',  name: 'Toxic Bite',  price: 300,  colors: ['#aaff00', '#22dd55'], glow: '#b6ff2e', head: '#f2ffdc' },
  { id: 'ocean',  name: 'Deep Ocean',  price: 450,  colors: ['#2e7bff', '#00e0d0'], glow: '#3aa0ff', head: '#dff4ff' },
  { id: 'fire',   name: 'Fire Serpent',price: 600,  colors: ['#ff5a00', '#ffc400'], glow: '#ff7a1a', head: '#fff0c4' },
  { id: 'ice',    name: 'Frost Fang',  price: 800,  colors: ['#9fd8ff', '#3f7bff'], glow: '#bfeaff', head: '#ffffff' },
  { id: 'cyber',  name: 'Cyber Grid',  price: 1000, colors: ['#b23bff', '#ff2d9b'], glow: '#c86bff', head: '#ffdaf7' },
  { id: 'galaxy', name: 'Galaxy',      price: 1400, colors: ['#34246b', '#9b4dff', '#ff5ecf'], glow: '#8f5cff', head: '#e9dcff' },
  { id: 'dragon', name: 'Dragon',      price: 1800, colors: ['#0e8a3e', '#7fe05a', '#eaff7a'], glow: '#43d66a', head: '#f6ffe0' },
  { id: 'gold',   name: 'Midas Gold',  price: 2500, colors: ['#ffb800', '#ffe97a', '#ff9500'], glow: '#ffd44d', head: '#fff8d6' },
];
export const skinById = (id: string): SkinDef => SKINS.find(s => s.id === id) || SKINS[0];

export const BOT_NAMES = [
  'Zigzag', 'Noodle', 'Viper', 'Slinky', 'Coilhead', 'Byte', 'Muncher', 'Hydra',
  'Kobra', 'Twist', 'Sushi', 'Rattata', 'Glitch', 'Pixel', 'Wasabi', 'Momo',
  'Booba', 'Luffy', 'Shenlong', 'Yamcha', 'Jaguar', 'Nova', 'Turbo', 'Zapp',
  'Chomp', 'Biscuit', 'Dumpling', 'Frank', 'Gizmo', 'Houdini', 'Ivan', 'Jinx',
];

export const LEVEL = {
  XP_PER_LEVEL: (lvl: number) => Math.round(120 * Math.pow(lvl, 1.35)),
  MAX_LEVEL: 60,
};

export type GameMode = 'classic' | 'practice' | 'quick' | 'br' | 'team';

export interface MatchConfig {
  mode: GameMode;
  snakes: number;        // total players incl. bots
  durationMs: number;    // match length
  shrinkStart?: number;  // BR: ms until circle starts shrinking
}

export const MODES: Record<GameMode, MatchConfig> = {
  classic: { mode: 'classic', snakes: 26, durationMs: 6 * 60_000 },
  quick:   { mode: 'quick',   snakes: 18, durationMs: 3 * 60_000 },
  practice:{ mode: 'practice',snakes: 14, durationMs: 5 * 60_000 },
  br:      { mode: 'br',      snakes: 20, durationMs: 5 * 60_000, shrinkStart: 45_000 },
  team:    { mode: 'team',    snakes: 20, durationMs: 5 * 60_000 },
};

// Map events
export const EVENTS = {
  FIRST_AT: 35_000,
  MIN_GAP: 26_000,
  MAX_GAP: 42_000,
  WARN_MS: 5000,
  GOLD_ZONE_LIFE: 18_000,
  SPEED_ZONE_LIFE: 16_000,
  PORTAL_LIFE: 22_000,
  CHEST_LIFE: 20_000,
  METEOR_WARN: 2200,
};

// Multiplayer protocol
export const NET = {
  TICK_MS: 50,            // server simulation tick
  SNAP_EVERY: 1,          // snapshots per tick
  INPUT_EVERY_MS: 50,
  INTERP_DELAY: 110,      // ms render delay for remote entities
  MAX_ROOM_PLAYERS: 40,
  FILL_WITH_BOTS: true,
  WS_PORT: 2567,
};

export type ClientMsg =
  | { t: 'input'; angle: number; boost: boolean; skill?: SkillId }
  | { t: 'respawn' }
  | { t: 'ping'; ts: number };

export type ServerSnap = {
  tick: number;
  time: number;               // elapsed ms
  left: number;               // ms remaining in match
  circle?: { x: number; y: number; r: number; next: number };
  me: NetSnake | null;
  snakes: NetSnake[];
  foodsAdd: NetFood[];
  foodsDel: number[];
  events: NetEvent[];
  kills: { by: string; victim: string; pts: number }[];
  lb: { id: string; name: string; score: number; len: number; you?: boolean }[];
};

export type NetSnake = {
  id: string; name: string; x: number; y: number; ang: number;
  len: number; score: number; boosts: boolean; dead: boolean;
  bot: boolean; skin: string; team?: number;
};
export type NetFood = { id: number; x: number; y: number; v: number; g: boolean; sz: number };
export type NetEvent = { kind: string; x?: number; y?: number; r?: number; msg?: string; life?: number };
