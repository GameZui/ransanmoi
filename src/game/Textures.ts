// ============================================================
// Procedural neon textures — no external assets, all generated.
// ============================================================
import Phaser from 'phaser';

const C = (g: Phaser.GameObjects.Graphics, hex: string) => Phaser.Display.Color.HexStringToColor(hex);

export function makeSnakeHead(scene: Phaser.Scene, skinId: string, colors: string[], headColor: string, glow: string): string {
  const key = `head_${skinId}`;
  if (scene.textures.exists(key)) return key;
  const size = 64;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // glow halo
  for (let i = 5; i >= 1; i--) {
    g.fillStyle(C(g, glow).color, 0.06 * i);
    g.fillCircle(size / 2, size / 2, 18 + i * 3);
  }
  // head body
  g.fillStyle(C(g, colors[0]).color, 1);
  g.fillCircle(size / 2, size / 2, 17);
  g.fillStyle(C(g, headColor).color, 0.9);
  g.fillEllipse(size / 2 + 3, size / 2, 24, 20);
  // eyes
  g.fillStyle(0xffffff, 1);
  g.fillCircle(size / 2 + 6, size / 2 - 7, 5.4);
  g.fillCircle(size / 2 + 6, size / 2 + 7, 5.4);
  g.fillStyle(0x101018, 1);
  g.fillCircle(size / 2 + 8, size / 2 - 7, 2.6);
  g.fillCircle(size / 2 + 8, size / 2 + 7, 2.6);
  // shine
  g.fillStyle(0xffffff, 0.5);
  g.fillEllipse(size / 2 - 4, size / 2 - 8, 9, 5);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

export function makeSegmentTextures(scene: Phaser.Scene, skinId: string, colors: string[], glow: string): string[] {
  const keys: string[] = [];
  const N = Math.min(colors.length, 3);
  for (let i = 0; i < N; i++) {
    const key = `seg_${skinId}_${i}`;
    keys.push(key);
    if (scene.textures.exists(key)) continue;
    const size = 40;
    const g = scene.add.graphics();
    g.fillStyle(C(g, glow).color, 0.16);
    g.fillCircle(size / 2, size / 2, size / 2 - 1);
    g.fillStyle(C(g, colors[i]).color, 1);
    g.fillCircle(size / 2, size / 2, 15);
    // inner highlight toward top-left for 3D-look
    g.fillStyle(0xffffff, 0.28);
    g.fillEllipse(size / 2 - 3, size / 2 - 4, 14, 10);
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(size / 2 + 4, size / 2 + 5, 16, 12);
    g.generateTexture(key, size, size);
    g.destroy();
  }
  return keys;
}

export function makeFoodTextures(scene: Phaser.Scene) {
  const defs: [string, string, string][] = [
    ['orb_cyan', '#3ef2ff', '#bffbff'],
    ['orb_green', '#5dff8f', '#d6ffe4'],
    ['orb_pink', '#ff6ad5', '#ffdaf7'],
    ['orb_gold', '#ffd44d', '#fff6cf'],
  ];
  for (const [key, col, core] of defs) {
    if (scene.textures.exists(key)) continue;
    const size = 34;
    const g = scene.add.graphics();
    g.fillStyle(C(g, col).color, 0.22);
    g.fillCircle(size / 2, size / 2, 16);
    g.fillStyle(C(g, col).color, 0.55);
    g.fillCircle(size / 2, size / 2, 10);
    g.fillStyle(C(g, core).color, 1);
    g.fillCircle(size / 2, size / 2, 5.5);
    g.generateTexture(key, size, size);
    g.destroy();
  }
  // spark particle
  if (!scene.textures.exists('spark')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 5);
    g.generateTexture('spark', 12, 12);
    g.destroy();
  }
  // soft white circle for glows/zones
  if (!scene.textures.exists('soft')) {
    const g = scene.add.graphics();
    for (let i = 10; i >= 1; i--) { g.fillStyle(0xffffff, 0.08); g.fillCircle(32, 32, i * 3); }
    g.generateTexture('soft', 64, 64);
    g.destroy();
  }
  // ring (used for shockwave/portal/meteor marker)
  if (!scene.textures.exists('ring')) {
    const g = scene.add.graphics();
    g.lineStyle(4, 0xffffff, 1); g.strokeCircle(48, 48, 44);
    g.generateTexture('ring', 96, 96);
    g.destroy();
  }
  if (!scene.textures.exists('ring_thick')) {
    const g = scene.add.graphics();
    g.lineStyle(9, 0xffffff, 0.9); g.strokeCircle(64, 64, 58);
    g.generateTexture('ring_thick', 128, 128);
    g.destroy();
  }
}

export function makeBackgroundTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('bg_grid')) return;
  const S = 480; // tile size (multiple of ARENA.GRID=120)
  const g = scene.add.graphics();
  g.fillStyle(0x0a0e23, 1); g.fillRect(0, 0, S, S);
  // subtle diagonal sheen
  g.fillStyle(0x121a3a, 0.5);
  for (let i = 0; i < 4; i++) g.fillRect(0, i * 120 + 60, S, 2);
  // grid lines
  g.lineStyle(2, 0x1c2a55, 0.9);
  for (let x = 0; x <= S; x += 120) { g.lineBetween(x, 0, x, S); }
  for (let y = 0; y <= S; y += 120) { g.lineBetween(0, y, S, y); }
  // dots at intersections
  g.fillStyle(0x2b3f7a, 1);
  for (let x = 0; x <= S; x += 120) for (let y = 0; y <= S; y += 120) g.fillCircle(x, y, 3);
  // faint decorative arcs (hex-ish arena pattern)
  g.lineStyle(1, 0x1a2b52, 0.8);
  g.strokeCircle(S / 2, S / 2, 170);
  g.strokeCircle(S / 2, S / 2, 90);
  g.generateTexture('bg_grid', S, S);
  g.destroy();
}
