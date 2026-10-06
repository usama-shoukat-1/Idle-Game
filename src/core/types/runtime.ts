/**
 * Non-persistent runtime state.
 *
 * `GameState` is what gets serialised. `RuntimeSnapshot` is the in-memory view that
 * includes derived values which are intentionally NOT saved (because they are
 * recomputed, or belong to the current session only). Keeping the split explicit
 * prevents "we saved a cached value and it went stale" bugs.
 */
export interface RuntimeSnapshot {
  /** Absolute epoch ms of the last frame the game saw (debug/telemetry). */
  readonly frameAt: number;
  /** Effective foreground time for this session in ms. */
  readonly sessionPlayTimeMs: number;
  /** Elapsed ms since the previous session that was settled as offline time. */
  readonly lastOfflineElapsedMs: number;
  /** Coins granted by the last offline settlement (Phase 0: 0, not yet tuned). */
  readonly lastOfflineCoins: number;
  /** Frames per second, sampled. Debug HUD only. */
  readonly fps: number;
  /** Entity/system counts for the debug HUD. */
  readonly debugCounters: Readonly<Record<string, number>>;
}
