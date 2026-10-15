// ============================================================
// Procedural audio (WebAudio) — zero external/copyrighted assets.
// Synth SFX + light electronic background loop.
// ============================================================

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let musicTimer: number | null = null;
let enabled = true;
let started = false;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      masterGain = ctx.createGain(); masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.16;
      musicGain.connect(masterGain);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (!c || started) return;
  started = true;
  startMusic();
}

export function setAudioEnabled(on: boolean) {
  enabled = on;
  if (masterGain) masterGain.gain.value = on ? 0.5 : 0;
  if (on) { ac(); if (started) startMusic(); }
}
export function isAudioEnabled() { return enabled; }

function blip(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number, dest?: AudioNode) {
  const c = ac(); if (!c || !masterGain) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(dest || masterGain);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}

function noise(dur: number, vol = 0.25, filterFreq = 1200) {
  const c = ac(); if (!c || !masterGain) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(masterGain);
  src.start();
}

let lastEatStep = 0;
export const Sfx = {
  eat(combo: number) {
    const scale = [523, 587, 659, 784, 880, 1046];
    const step = Math.min(combo, 12);
    const f = scale[step % scale.length] * (1 + Math.floor(step / scale.length) * 0.5);
    blip(f, 0.09, 'triangle', 0.22, f * 1.2);
  },
  gold() { blip(1318, 0.14, 'sine', 0.3, 1760); blip(1760, 0.2, 'sine', 0.18); },
  combo(n: number) {
    blip(660 + n * 12, 0.12, 'square', 0.14, 990 + n * 12);
  },
  fever() { for (let i = 0; i < 4; i++) setTimeout(() => blip(700 + i * 220, 0.12, 'sawtooth', 0.12), i * 60); },
  goldRush() { for (let i = 0; i < 6; i++) setTimeout(() => blip(500 + i * 180, 0.16, 'square', 0.1), i * 70); },
  boostOn() { blip(180, 0.25, 'sawtooth', 0.12, 420); },
  kill() { noise(0.35, 0.4, 900); blip(220, 0.4, 'sawtooth', 0.25, 60); },
  bigKill() { noise(0.6, 0.5, 600); blip(140, 0.7, 'sawtooth', 0.3, 40); setTimeout(() => blip(880, 0.3, 'square', 0.12, 1400), 120); },
  death() { blip(400, 0.8, 'sawtooth', 0.3, 50); noise(0.5, 0.3, 500); },
  skill(kind: string) {
    if (kind === 'dash') blip(300, 0.3, 'sawtooth', 0.2, 900);
    else if (kind === 'shield') blip(500, 0.4, 'sine', 0.22, 700);
    else if (kind === 'magnet') blip(250, 0.5, 'sine', 0.18, 500);
    else if (kind === 'ghost') blip(900, 0.5, 'sine', 0.14, 300);
    else { noise(0.4, 0.45, 2400); blip(120, 0.5, 'square', 0.3, 40); }
  },
  ui() { blip(700, 0.06, 'square', 0.1, 900); },
  buy() { blip(523, 0.1, 'square', 0.15); setTimeout(() => blip(784, 0.15, 'square', 0.15), 80); },
  deny() { blip(200, 0.18, 'square', 0.15, 120); },
  announce() { blip(600, 0.12, 'triangle', 0.16, 800); setTimeout(() => blip(800, 0.16, 'triangle', 0.14), 100); },
  win() { const ns = [523, 659, 784, 1046, 784, 1046, 1318]; ns.forEach((n, i) => setTimeout(() => blip(n, 0.22, 'triangle', 0.2), i * 130)); },
  portal() { blip(300, 0.35, 'sine', 0.2, 1200); },
};

// ------- simple generative music loop (chill synthwave-ish) -------
const BASS = [110, 110, 87.3, 98];                 // A2 A2 F2 G2
const CHORDS = [[220, 261.6, 329.6], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
const ARP = [0, 1, 2, 1];
let bar = 0;

function startMusic() {
  const c = ac(); if (!c || !musicGain || musicTimer !== null) return;
  const stepDur = 0.42;
  let nextTime = c.currentTime + 0.1;
  musicTimer = window.setInterval(() => {
    if (!enabled || !ctx) return;
    while (nextTime < ctx.currentTime + 0.6) {
      const t = nextTime;
      const b = bar % 4;
      // bass
      playNote(BASS[b], t, stepDur * 1.8, 'triangle', 0.5, musicGain!);
      // chord pad every bar
      if (bar % 2 === 0) for (const f of CHORDS[b]) playNote(f, t, stepDur * 3.6, 'sine', 0.12, musicGain!, true);
      // arpeggio sparkle
      const a = ARP[bar % 4];
      playNote(CHORDS[b][a] * 2, t, stepDur * 0.5, 'square', 0.06, musicGain!);
      nextTime += stepDur; bar++;
    }
  }, 250) as unknown as number;
}

function playNote(freq: number, at: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, attackSlow = false) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + (attackSlow ? 0.4 : 0.02));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(dest);
  o.start(at); o.stop(at + dur + 0.05);
}
