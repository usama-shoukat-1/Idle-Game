# Assets

Phase 0 ships **no binary assets**. Every visual is generated procedurally at boot
(`src/assets/placeholders/PlaceholderArt.ts`), which keeps the repository clean and avoids
placeholder art that would be thrown away once the real illustrated style arrives.

## Where real art will go

```
src/assets/
  images/        static UI art, icons
  sprites/       animated sprites / atlases
  backgrounds/   district + stage backdrops
  audio/         music + sfx
  fonts/         webfonts (only if the system font stack is not enough)
```

Folders are created when the first file lands — no empty directories are tracked.

## How to add an asset

1. Put the file in the matching folder.
2. Add an entry to `ASSET_MANIFEST` in `src/config/content/index.ts`
   (`{ key, url, type: 'image' | 'spritesheet' | 'atlas' | 'audio' | 'json', group? }`).
3. `PreloadScene` loads it automatically (import the file or place it under `public/`
   so Vite can resolve the URL).
4. Reference the `key` from content (`VisualStateDefinition.textureKey`) or UI code.

## Placeholder keys available today

| Key | Purpose |
|---|---|
| `placeholder-pixel` | 1×1 white pixel for bars/rects |
| `placeholder-panel` | rounded panel |
| `placeholder-button` | button plate |
| `placeholder-coin` / `placeholder-gem` | currency chips |
| `placeholder-building-blocked` / `placeholder-building-restored` | building silhouettes |
| `placeholder-glow` | soft highlight |
| `placeholder-tile` | ground tile for the world placeholder |

`generatePlaceholderTextures()` is idempotent: textures are created only when absent, so
scene restarts do not leak GPU memory.
