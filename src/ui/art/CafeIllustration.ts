import Phaser from 'phaser';

/**
 * OLD CAFÉ ILLUSTRATION (procedural)
 * =================================
 * The café is drawn with vector shapes instead of bitmap art. Two reasons:
 *  1. no binary assets in the repository (see docs/DEVELOPMENT_RULES.md), and
 *  2. restoration is *cumulative*: every tier contributes its own layer, so "restore the
 *     electricity" literally switches on the windows and the sign.
 *
 * Structure
 * ---------
 * `BASE`     the permanent shell: sky, street, façade, roof, dark windows, door.
 * `RUINS`    what restoration *removes*: debris (gone at tier 1) and the window boards
 *            (gone at tier 3). Removals need their own layers because a Graphics layer
 *            can only draw - so "boards come off" is a visibility flip, not a redraw.
 * `TIERS[n]` the elements that step n adds (cleared floor, furniture, lights, counter,
 *            kitchen, seating, worker, menu, extension, premium finish).
 *
 * Everything is authored in **design units** inside a 640x600 box centred on the
 * container's origin, so it scales with the rest of the UI and never depends on the
 * device aspect ratio. Layers are plain `Graphics` objects toggled by tier, which means a
 * tier change is a visibility flip - no texture uploads, no per-frame drawing.
 *
 * The art direction is intentionally warm and readable: terracotta walls, cream trim, a
 * teal awning, and a strong warm/cool contrast between "dark and shut" (tier 0) and
 * "lit and alive" (tier 3+), so a player can see their progress from across the room.
 */

/** Design-unit bounds of the illustration (centred on the container origin). */
export const CAFE_ART_SIZE = { width: 640, height: 600 } as const;

const GROUND_Y = 150;
const BUILDING_LEFT = -250;
const BUILDING_RIGHT = 190;
const BUILDING_TOP = -150;

const COLORS = {
  skyTop: 0x2c3a4e,
  skyBottom: 0x435a72,
  street: 0x39434f,
  pavement: 0x4d5866,
  wall: 0xa9705a,
  wallShade: 0x8d5b49,
  wallDark: 0x6f4638,
  trim: 0xe8d9bd,
  roof: 0x6d4a3c,
  roofLight: 0x84604f,
  wood: 0x7a5334,
  windowDark: 0x241f22,
  windowLit: 0xffd98a,
  windowWarm: 0xffbe63,
  teal: 0x3f7d7b,
  tealDark: 0x2f6060,
  metal: 0x9aa7b4,
  debris: 0x6b5a4a,
  debrisDark: 0x4f4237,
  weed: 0x5c7a52,
  glow: 0xffcf7a,
  steam: 0xd9e3ee,
  skin: 0xe3b48c,
  apron: 0xf0e6d2,
} as const;

export interface CafeIllustrationOptions {
  readonly scene: Phaser.Scene;
  readonly depth?: number;
}

export class CafeIllustration {
  readonly container: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Graphics;
  /** Details that disappear as the café is restored: { layer, visibleBelowTier }. */
  private readonly ruins: Array<{ layer: Phaser.GameObjects.Graphics; until: number }> = [];
  private readonly tierLayers: Phaser.GameObjects.Graphics[] = [];
  private readonly ambient: Phaser.GameObjects.Graphics;
  private readonly glowTween: Phaser.Tweens.Tween | null = null;
  private tier = -1;

  constructor(options: CafeIllustrationOptions) {
    this.scene = options.scene;
    this.container = options.scene.add.container(0, 0);
    if (options.depth !== undefined) this.container.setDepth(options.depth);

    this.base = options.scene.add.graphics();
    this.container.add(this.base);
    drawBase(this.base);

    // Ruin layers, drawn above the shell but below every restoration layer.
    for (const ruin of [
      { until: 1, draw: drawDebris },
      { until: 3, draw: drawBoards },
    ]) {
      const layer = options.scene.add.graphics();
      ruin.draw(layer);
      this.container.add(layer);
      this.ruins.push({ layer, until: ruin.until });
    }

    // One layer per restoration step (index 0 === tier 1) so every step is visible.
    for (let step = 1; step <= 10; step += 1) {
      const layer = options.scene.add.graphics();
      layer.setVisible(false);
      this.container.add(layer);
      drawTierLayer(layer, step);
      this.tierLayers.push(layer);
    }

    // Ambient layer (live light flicker) sits above everything else in the illustration.
    this.ambient = options.scene.add.graphics();
    this.container.add(this.ambient);

    // A very slow, very subtle breathing light. Two objects tweened by alpha - no timers,
    // no particles, no per-frame work.
    this.glowTween = options.scene.tweens.add({
      targets: this.container,
      alpha: { from: 0.98, to: 1 },
      duration: 2_600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.setTier(0, false);
  }

  get currentTier(): number {
    return this.tier;
  }

  get x(): number {
    return this.container.x;
  }

  get y(): number {
    return this.container.y;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  setScale(scale: number): this {
    this.container.setScale(scale);
    return this;
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    return this;
  }

  /** Shows exactly the layers the tier has unlocked. */
  setTier(tier: number, animate = true): void {
    const clamped = Math.max(0, Math.min(10, Math.floor(tier)));
    if (clamped === this.tier) return;
    this.tier = clamped;

    for (const ruin of this.ruins) {
      ruin.layer.setVisible(clamped < ruin.until);
    }

    this.tierLayers.forEach((layer, index) => {
      const visible = index + 1 <= clamped;
      if (layer.visible === visible) return;
      layer.setVisible(visible);
      if (visible && animate) {
        // Newly revealed work pops in: a short scale/alpha nudge on the *layer*, so
        // nothing else on screen moves.
        layer.setAlpha(0);
        this.scene.tweens.add({
          targets: layer,
          alpha: 1,
          duration: 420,
          ease: 'Quad.easeOut',
        });
      } else if (visible) {
        layer.setAlpha(1);
      }
    });

    this.drawAmbient();
  }

  /** Rewrites the ambient layer for the current tier (light halo once electricity is on). */
  private drawAmbient(): void {
    this.ambient.clear();
    if (this.tier < 3) return;
    this.ambient.fillStyle(COLORS.glow, 0.1);
    this.ambient.fillCircle(-30, -60, 210);
    if (this.tier >= 10) {
      this.ambient.fillStyle(COLORS.glow, 0.08);
      this.ambient.fillCircle(120, -30, 190);
    }
  }

  /** Handles used by the scene to place effects (coin pops, customers). */
  get doorAnchor(): { x: number; y: number } {
    return { x: -30, y: GROUND_Y - 20 };
  }

  get seatingAnchor(): { x: number; y: number } {
    return { x: -120, y: GROUND_Y - 40 };
  }

  get counterAnchor(): { x: number; y: number } {
    return { x: 40, y: GROUND_Y - 60 };
  }

  get roofAnchor(): { x: number; y: number } {
    return { x: -30, y: BUILDING_TOP - 20 };
  }

  destroy(): void {
    this.glowTween?.remove();
    this.container.removeAll(true);
    this.container.destroy();
  }
}

// ---------------------------------------------------------------------------
// Base shell (tier 0): dark sky, cracked façade, boarded windows, debris
// ---------------------------------------------------------------------------

function drawBase(g: Phaser.GameObjects.Graphics): void {
  const halfWidth = CAFE_ART_SIZE.width / 2;
  const halfHeight = CAFE_ART_SIZE.height / 2;

  // Sky backdrop (a soft two-tone wash rather than a flat rectangle).
  g.fillStyle(COLORS.skyTop, 1);
  g.fillRect(-halfWidth, -halfHeight, CAFE_ART_SIZE.width, CAFE_ART_SIZE.height);
  g.fillStyle(COLORS.skyBottom, 0.85);
  g.fillRect(-halfWidth, -halfHeight + CAFE_ART_SIZE.height * 0.42, CAFE_ART_SIZE.width, CAFE_ART_SIZE.height * 0.58);

  // Street + pavement.
  g.fillStyle(COLORS.street, 1);
  g.fillRect(-halfWidth, GROUND_Y + 46, CAFE_ART_SIZE.width, halfHeight - GROUND_Y - 46);
  g.fillStyle(COLORS.pavement, 1);
  g.fillRect(BUILDING_LEFT - 40, GROUND_Y, 520, 46);
  g.lineStyle(3, 0x000000, 0.18);
  g.lineBetween(-halfWidth, GROUND_Y + 46, halfWidth, GROUND_Y + 46);

  // Façade: two storeys with a darker ground floor.
  g.fillStyle(COLORS.wall, 1);
  g.fillRect(BUILDING_LEFT, BUILDING_TOP, BUILDING_RIGHT - BUILDING_LEFT, GROUND_Y - BUILDING_TOP);
  g.fillStyle(COLORS.wallShade, 1);
  g.fillRect(BUILDING_LEFT, BUILDING_TOP + 170, BUILDING_RIGHT - BUILDING_LEFT, GROUND_Y - BUILDING_TOP - 170);

  // Roof: a slight overhang with tiles.
  g.fillStyle(COLORS.roof, 1);
  g.fillRect(BUILDING_LEFT - 18, BUILDING_TOP - 30, BUILDING_RIGHT - BUILDING_LEFT + 36, 34);
  g.fillStyle(COLORS.roofLight, 1);
  g.fillRect(BUILDING_LEFT - 18, BUILDING_TOP - 30, BUILDING_RIGHT - BUILDING_LEFT + 36, 8);
  g.lineStyle(2, 0x000000, 0.18);
  for (let x = BUILDING_LEFT - 10; x < BUILDING_RIGHT + 10; x += 26) {
    g.lineBetween(x, BUILDING_TOP - 30, x, BUILDING_TOP + 4);
  }

  // Cracking plaster, deliberately sparse so it reads as "tired", not "ruined".
  g.lineStyle(2, COLORS.wallDark, 0.55);
  g.lineBetween(-200, -60, -176, -18);
  g.lineBetween(-176, -18, -196, 34);
  g.lineBetween(120, -110, 146, -60);
  g.lineBetween(146, -60, 128, -14);

  // Upper windows (dark, dusty).
  drawWindow(g, -170, -110, 96, 92, false);
  drawWindow(g, 60, -110, 96, 92, false);

  // Ground floor windows either side of the door (boards are a separate ruin layer).
  drawWindow(g, -196, 20, 110, 96, false);
  drawWindow(g, 104, 20, 92, 96, false);

  // Door: shut, with a closed sign.
  g.fillStyle(COLORS.wood, 1);
  g.fillRect(-60, 0, 84, 150);
  g.lineStyle(3, COLORS.wallDark, 0.7);
  g.strokeRect(-60, 0, 84, 150);
  g.fillStyle(COLORS.windowDark, 0.9);
  g.fillRect(-46, 18, 56, 60);
  g.fillStyle(COLORS.trim, 0.9);
  g.fillRect(-52, 92, 68, 26);
  g.fillStyle(0x8c3a2f, 1);
  g.fillCircle(-28, 110, 7);

  // Faded, unlit sign above the door.
  g.fillStyle(COLORS.wallDark, 1);
  g.fillRect(-96, -74, 156, 42);
  g.fillStyle(COLORS.trim, 0.35);
  g.fillRect(-90, -68, 144, 30);

}

/** Debris, planks and weeds in front of the shopfront - cleared by tier 1. */
function drawDebris(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLORS.debris, 1);
  g.fillRect(-238, 96, 54, 54);
  g.fillStyle(COLORS.debrisDark, 1);
  g.fillRect(-238, 96, 54, 12);
  g.fillStyle(COLORS.debris, 1);
  g.fillRect(150, 108, 46, 42);
  g.fillStyle(COLORS.debrisDark, 1);
  g.fillRect(150, 108, 46, 10);
  g.lineStyle(6, COLORS.debrisDark, 1);
  g.lineBetween(-120, 142, -40, 160);
  g.lineBetween(-100, 152, -20, 132);
  g.fillStyle(COLORS.weed, 0.9);
  g.fillCircle(-246, 142, 12);
  g.fillCircle(-224, 148, 9);
  g.fillCircle(178, 140, 11);
  g.fillCircle(196, 146, 8);
}

/** Boards nailed over the shopfront windows - pried off once the lights work (tier 3). */
function drawBoards(g: Phaser.GameObjects.Graphics): void {
  drawPlanks(g, -196, 20, 110, 96);
  drawPlanks(g, 104, 20, 92, 96);
}

// ---------------------------------------------------------------------------
// Tier layers: what each restoration step adds
// ---------------------------------------------------------------------------

function drawTierLayer(g: Phaser.GameObjects.Graphics, step: number): void {
  switch (step) {
    case 1:
      // Clear the debris: swept pavement, fresh kerb line, a visible doorstep.
      g.fillStyle(COLORS.pavement, 0.55);
      g.fillRect(BUILDING_LEFT - 36, GROUND_Y + 2, 512, 40);
      g.lineStyle(4, COLORS.trim, 0.6);
      g.lineBetween(BUILDING_LEFT + 6, GROUND_Y - 4, BUILDING_RIGHT - 6, GROUND_Y - 4);
      g.fillStyle(COLORS.trim, 0.9);
      g.fillRect(-62, 148, 88, 8);
      break;

    case 2:
      // Repair the furniture: two tables with chairs, seen through the windows and
      // outside on the pavement.
      drawTable(g, -196, 74);
      drawTable(g, 104, 74);
      drawTable(g, -150, GROUND_Y - 6);
      break;

    case 3:
      // Restore the electricity: the big visual turn - lit windows, glowing sign, string
      // lights across the front.
      drawWindow(g, -170, -110, 96, 92, true);
      drawWindow(g, 60, -110, 96, 92, true);
      drawWindow(g, -196, 20, 110, 96, true);
      drawWindow(g, 104, 20, 92, 96, true);
      drawLightPool(g, -196, 60);
      drawLightPool(g, 104, 60);
      // Illuminated sign.
      g.fillStyle(COLORS.windowWarm, 1);
      g.fillRect(-90, -68, 144, 30);
      g.fillStyle(0x7a3a1f, 1);
      g.fillRect(-84, -62, 132, 6);
      g.fillRect(-84, -50, 96, 6);
      drawStringLights(g);
      break;

    case 4:
      // Repair the counter: a serving counter and a chalkboard inside the shopfront.
      g.fillStyle(COLORS.wood, 1);
      g.fillRect(18, 44, 150, 34);
      g.fillStyle(COLORS.trim, 1);
      g.fillRect(18, 44, 150, 8);
      g.fillStyle(COLORS.wood, 1);
      g.fillRect(28, 78, 12, 62);
      g.fillRect(146, 78, 12, 62);
      // Serving hatch light spilling onto the pavement.
      drawLightPool(g, 40, 66);
      break;

    case 5:
      // Restore the kitchen: an extractor hood, a machine and steam above the roofline.
      g.fillStyle(COLORS.metal, 1);
      g.fillRect(-238, -8, 74, 20);
      g.fillStyle(COLORS.metal, 0.85);
      g.fillRect(-232, 12, 62, 34);
      g.fillStyle(0x2f2b28, 1);
      g.fillRect(-226, 46, 50, 12);
      drawSteam(g, -206, -20);
      break;

    case 6:
      // Add seating: more tables outside, benches, and a hatched awning over them.
      drawAwning(g, -250, -20, 214);
      drawTable(g, -216, GROUND_Y - 6);
      drawTable(g, -84, GROUND_Y - 6);
      drawBench(g, 24, GROUND_Y - 10);
      break;

    case 7:
      // Hire the first worker: a barista behind the counter with a warm apron.
      drawWorker(g, 92, 24);
      break;

    case 8:
      // Upgrade menu & service: a menu board on the pavement, a coffee sign, more cups.
      g.fillStyle(COLORS.tealDark, 1);
      g.fillRect(-262, 26, 56, 84);
      g.fillStyle(COLORS.trim, 0.92);
      g.fillRect(-256, 34, 44, 6);
      g.fillRect(-256, 48, 36, 5);
      g.fillRect(-256, 60, 40, 5);
      g.fillStyle(COLORS.wood, 1);
      g.fillRect(-240, 110, 12, 34);
      // Service details: cups on the counter and a second machine.
      g.fillStyle(COLORS.trim, 1);
      g.fillCircle(58, 38, 8);
      g.fillCircle(78, 38, 8);
      g.fillStyle(COLORS.metal, 1);
      g.fillRect(120, 22, 40, 22);
      break;

    case 9:
      // Expand the café: a side extension with its own roof and lit window.
      g.fillStyle(COLORS.wallShade, 1);
      g.fillRect(190, -40, 130, GROUND_Y + 40);
      g.fillStyle(COLORS.roof, 1);
      g.fillRect(182, -66, 146, 30);
      g.fillStyle(COLORS.roofLight, 1);
      g.fillRect(182, -66, 146, 7);
      drawWindow(g, 256, 20, 78, 84, true);
      drawLightPool(g, 256, 62);
      g.fillStyle(COLORS.trim, 1);
      g.fillRect(196, -8, 118, 8);
      break;

    case 10:
      // Premium renovation: planters, flowers, bunting and a polished frontage.
      drawPlanter(g, -256, GROUND_Y - 34);
      drawPlanter(g, 296, GROUND_Y - 34);
      drawBunting(g);
      g.fillStyle(COLORS.trim, 0.9);
      g.fillRect(-62, -2, 88, 6);
      g.fillStyle(COLORS.glow, 0.22);
      g.fillRect(-250, BUILDING_TOP - 30, 570, 6);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers (all coordinates are design units, origin at the café centre)
// ---------------------------------------------------------------------------

function drawWindow(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  width: number,
  height: number,
  lit: boolean,
): void {
  const x = cx - width / 2;
  const y = cy - height / 2;

  g.fillStyle(lit ? COLORS.windowLit : COLORS.windowDark, 1);
  g.fillRect(x, y, width, height);
  if (lit) {
    g.fillStyle(COLORS.windowWarm, 0.55);
    g.fillRect(x, y + height * 0.55, width, height * 0.45);
  }
  g.lineStyle(4, COLORS.trim, 1);
  g.strokeRect(x, y, width, height);
  g.lineStyle(3, COLORS.trim, 0.9);
  g.lineBetween(cx, y, cx, y + height);
  g.lineBetween(x, cy, x + width, cy);
}

/** Boards nailed over a window (tier 0 only). */
function drawPlanks(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  width: number,
  height: number,
): void {
  const x = cx - width / 2;
  const y = cy - height / 2;
  g.fillStyle(COLORS.wood, 1);
  g.fillRect(x - 4, y + height * 0.18, width + 8, 16);
  g.fillRect(x - 4, y + height * 0.55, width + 8, 16);
  g.lineStyle(2, COLORS.wallDark, 0.7);
  g.strokeRect(x - 4, y + height * 0.18, width + 8, 16);
  g.strokeRect(x - 4, y + height * 0.55, width + 8, 16);
}

/** Warm light spilling from a window onto the pavement. */
function drawLightPool(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.glow, 0.14);
  g.fillEllipse(cx, cy + 88, 190, 90);
  g.fillStyle(COLORS.glow, 0.1);
  g.fillEllipse(cx, cy + 78, 130, 60);
}

function drawTable(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.trim, 1);
  g.fillRect(cx - 30, cy - 26, 60, 10);
  g.fillStyle(COLORS.wood, 1);
  g.fillRect(cx - 4, cy - 16, 8, 26);
  g.fillStyle(COLORS.wood, 1);
  g.fillRect(cx - 22, cy - 10, 12, 18); // chair
  g.fillRect(cx + 10, cy - 10, 12, 18);
  g.fillStyle(COLORS.trim, 1);
  g.fillCircle(cx, cy - 32, 5); // cup
}

function drawBench(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.wood, 1);
  g.fillRect(cx - 40, cy - 18, 80, 12);
  g.fillRect(cx - 36, cy - 6, 8, 16);
  g.fillRect(cx + 28, cy - 6, 8, 16);
}

function drawAwning(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number): void {
  const stripeWidth = width / 6;
  for (let i = 0; i < 6; i += 1) {
    g.fillStyle(i % 2 === 0 ? COLORS.teal : COLORS.trim, 1);
    g.fillRect(x + i * stripeWidth, y, stripeWidth, 26);
  }
  g.fillStyle(COLORS.tealDark, 1);
  g.fillRect(x, y + 26, width, 6);
}

function drawWorker(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.apron, 1);
  g.fillRect(cx - 14, cy, 28, 44);
  g.fillStyle(COLORS.teal, 1);
  g.fillRect(cx - 14, cy, 28, 10);
  g.fillStyle(COLORS.skin, 1);
  g.fillCircle(cx, cy - 12, 13);
  g.fillStyle(0x3a2b22, 1);
  g.fillRect(cx - 14, cy - 24, 28, 10);
}

function drawSteam(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.steam, 0.25);
  g.fillCircle(cx, cy, 16);
  g.fillCircle(cx + 14, cy - 16, 12);
  g.fillCircle(cx - 12, cy - 22, 9);
}

function drawStringLights(g: Phaser.GameObjects.Graphics): void {
  g.lineStyle(2, 0x2a2a2a, 0.7);
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const x = BUILDING_LEFT - 6 + t * (BUILDING_RIGHT - BUILDING_LEFT + 12);
    const y = -150 + Math.sin(t * Math.PI) * 26;
    points.push([x, y]);
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    g.lineBetween(points[i]![0], points[i]![1], points[i + 1]![0], points[i + 1]![1]);
  }
  for (const [x, y] of points) {
    g.fillStyle(COLORS.glow, 0.9);
    g.fillCircle(x, y + 6, 5);
  }
}

function drawPlanter(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
  g.fillStyle(COLORS.tealDark, 1);
  g.fillRect(cx - 22, cy, 44, 34);
  g.fillStyle(COLORS.weed, 1);
  g.fillCircle(cx - 10, cy - 6, 12);
  g.fillCircle(cx + 10, cy - 10, 14);
  g.fillStyle(0xe4698a, 1);
  g.fillCircle(cx - 4, cy - 16, 5);
  g.fillCircle(cx + 16, cy - 20, 4);
}

function drawBunting(g: Phaser.GameObjects.Graphics): void {
  const colours = [0xe4698a, 0xf2b544, 0x5fd0ff, 0x5cd68a];
  g.lineStyle(2, 0x2a2a2a, 0.6);
  g.lineBetween(BUILDING_LEFT - 20, -196, BUILDING_RIGHT + 20, -186);
  for (let i = 0; i < 10; i += 1) {
    const t = i / 9;
    const x = BUILDING_LEFT - 20 + t * (BUILDING_RIGHT - BUILDING_LEFT + 40);
    const y = -196 + t * 10;
    g.fillStyle(colours[i % colours.length]!, 1);
    g.fillTriangle(x - 8, y, x + 8, y, x, y + 20);
  }
}
