/**
 * Vite entry point.
 *
 * Intentionally tiny: all engine assembly lives in `src/core/Game.ts` so that the DOM entry,
 * a future native shell and automated smoke tests all boot the game through the same path.
 */
import { autoStart } from '@/core/Game';

// global.css is linked from index.html so the boot splash is styled before JS executes.
autoStart();
