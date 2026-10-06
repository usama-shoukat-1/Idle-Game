# Assets

Phase 0 ships **no binary assets**. Placeholder textures are generated at runtime in
`src/scenes/PreloadScene.ts` (`generatePlaceholderTextures`), which keeps the repository light,
makes a cold start work offline, and proves the texture pipeline on the real renderer.

Landing zones for the art/audio pass:

| Folder | Contents |
|---|---|
| `images/` | raw source exports (atlas pages, UI sheets) |
| `sprites/` | runtime sprite sheets / atlases loaded by Phaser |
| `backgrounds/` | stage and district backgrounds |
| `audio/` | music and SFX (`.ogg` + `.m4a` for iOS coverage) |
| `fonts/` | webfont files, if the final art direction needs custom type |

## Loading rules (see docs/MOBILE_DESIGN.md)

1. Declare loads **only** in `PreloadScene.preload()` and keep keys namespaced
   (`building/cafe/facade_1`, `sfx/upgrade_complete`).
2. Reference textures by key from content (`VisualStateDefinition.layers`), never by file path
   from systems or scenes.
3. Prefer atlases over individual files: fewer requests, fewer GPU state changes on mobile.
4. Keep the boot bundle small and lazy-load future districts behind the loading scene.
5. Large source files belong in external storage, not in git — this folder is for runtime
   assets only.

## Budget guidance for Phase 1

- boot bundle target: < 1.5 MB gzipped including Phaser
- one atlas per district, 2048² max, power-of-two
- audio: 44.1 kHz, mono for SFX, streamed music where the platform allows
