/**
 * Content configuration that is not gameplay data: asset manifest, audio registry
 * and UI copy hooks. Kept separate from `src/data/**` (which is game content) and
 * from `src/core/**` (which is engine code).
 */

export interface AssetDefinition {
  key: string;
  /** Path under `public/` or a Vite-resolved URL. Empty in Phase 0. */
  url: string;
  /** Phaser loader type. */
  type: 'image' | 'spritesheet' | 'atlas' | 'audio' | 'json';
  /** Optional preload grouping, so future stages can lazy-load their art. */
  group?: string;
}

/**
 * Asset manifest. Phase 0 ships ZERO binary assets: every visual is generated as a
 * placeholder texture at runtime (`src/assets/placeholders`). Add entries here and
 * the PreloadScene picks them up automatically.
 */
export const ASSET_MANIFEST: AssetDefinition[] = [];

/** Audio registry (also empty in Phase 0 - the AudioManager no-ops unknown keys). */
export const SOUND_REGISTRY = [
  { key: 'sfx.ui.tap', bus: 'sfx' as const },
  { key: 'sfx.coins', bus: 'sfx' as const },
  { key: 'sfx.upgrade.complete', bus: 'sfx' as const },
  { key: 'sfx.notification', bus: 'sfx' as const },
  { key: 'music.main-menu', bus: 'music' as const, loop: true },
  { key: 'music.district', bus: 'music' as const, loop: true },
];

/** Placeholder palette used by generated textures + UI theme (see ui/UiTheme). */
export const PLACEHOLDER_PALETTE = {
  asphalt: 0x1f2530,
  facade: 0x3d4757,
  facadeRestored: 0x4f7f6a,
  accent: 0xffb347,
  coin: 0xffd166,
  gem: 0x6fd3ff,
} as const;
