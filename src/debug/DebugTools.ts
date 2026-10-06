/**
 * Development-only tooling.
 *
 * Separated from release behaviour in three ways: it is only constructed when
 * `GameConfig.debug.enabled` is true, it is replaced by `NullDebugTools` otherwise,
 * and the keyboard shortcuts are registered by the (dev-only) overlay.
 */

import type Phaser from 'phaser';
import type { GameContext } from '@/core/GameContext';
import type { StageId } from '@/core/types/ids';
import { createLogger } from '@/core/utils/logger';
import { formatNumber } from '@/core/utils/numbers';
import { formatDuration } from '@/core/utils/time';
import type { InputManager } from '@/systems/InputSystem';
import { DEBUG_ACTIONS, type DebugApi } from './DebugApi';

export interface DebugToolsOptions {
  /** Late-bound context accessor: tools are created while the context is still building. */
  getContext: () => GameContext | null;
  enabled: boolean;
}

const CHEAT_COINS = 1_000;
const CHEAT_GEMS = 100;

export class DebugTools implements DebugApi {
  readonly enabled: boolean;
  private readonly log = createLogger('debug');
  private game: Phaser.Game | null = null;
  private overlayVisible = true;
  private readonly subscriptions: Array<{ off(): void }> = [];

  constructor(private readonly options: DebugToolsOptions) {
    this.enabled = options.enabled;
  }

  /* ------------------------------------------------------------- wiring */

  /** Attach the Phaser game (used for FPS reporting). */
  attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  /** Register desktop keyboard shortcuts. Mobile ignores this entirely. */
  registerShortcuts(input: InputManager): void {
    if (!this.enabled) return;
    const map: Record<string, string> = {
      Digit1: DEBUG_ACTIONS.addCoins,
      Digit2: DEBUG_ACTIONS.addGems,
      Digit3: DEBUG_ACTIONS.unlockAll,
      Digit4: DEBUG_ACTIONS.unlockStage,
      Digit5: DEBUG_ACTIONS.finishTimers,
      Digit6: DEBUG_ACTIONS.toggleOverlay,
      Digit7: DEBUG_ACTIONS.resetSave,
      Digit8: DEBUG_ACTIONS.summary,
    };
    for (const [code, action] of Object.entries(map)) input.registerKeyAction(code, action);

    this.subscriptions.push(
      input.onKeyAction(({ action }) => {
        switch (action) {
          case DEBUG_ACTIONS.addCoins:
            this.addCoins();
            break;
          case DEBUG_ACTIONS.addGems:
            this.addGems();
            break;
          case DEBUG_ACTIONS.unlockAll:
            this.unlockAllBuildings();
            break;
          case DEBUG_ACTIONS.unlockStage:
            this.unlockStage();
            break;
          case DEBUG_ACTIONS.finishTimers:
            this.finishTimers();
            break;
          case DEBUG_ACTIONS.toggleOverlay:
            this.toggleOverlay();
            break;
          case DEBUG_ACTIONS.resetSave:
            this.resetSave();
            break;
          case DEBUG_ACTIONS.summary:
            this.log.info(this.stateSummary());
            break;
          default:
            break;
        }
      }),
    );
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.off();
    this.subscriptions.length = 0;
    this.game = null;
  }

  /* -------------------------------------------------------------- cheats */

  addCoins(amount = CHEAT_COINS): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    const result = ctx.economy.add('coins', amount, 'debug:grant');
    this.afterCheat('add-coins', `+${amount} coins (${result.ok ? 'ok' : result.message})`);
  }

  addGems(amount = CHEAT_GEMS): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    const result = ctx.economy.add('gems', amount, 'debug:grant');
    this.afterCheat('add-gems', `+${amount} gems (${result.ok ? 'ok' : result.message})`);
  }

  unlockAllBuildings(): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    let unlocked = 0;
    for (const definition of ctx.content.listBuildings()) {
      if (ctx.buildings.unlock(definition.id)) unlocked += 1;
    }
    this.afterCheat('unlock-all-buildings', `${unlocked} unlocked`);
  }

  unlockStage(stageId?: StageId): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    const target = stageId ?? ctx.content.listStages().find((stage) => !ctx.progression.isStageUnlocked(stage.id))?.id;
    if (!target) {
      this.afterCheat('unlock-stage', 'no locked stage to unlock');
      return;
    }
    const ok = ctx.progression.forceUnlockStage(target);
    this.afterCheat('unlock-stage', `${target} ${ok ? 'unlocked' : 'already unlocked'}`);
  }

  finishTimers(): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    const upgrades = ctx.upgrades.finishAllActive();
    let timers = 0;
    for (const timer of ctx.timers.getAll('running')) {
      if (ctx.timers.completeNow(timer.id)) timers += 1;
    }
    this.afterCheat('finish-timers', `${upgrades} upgrade(s), ${timers} timer(s)`);
  }

  addTaps(count = 10): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    ctx.state.update((state) => {
      state.stats.totalTaps += count;
    });
    this.afterCheat('add-taps', `+${count} taps`);
  }

  resetSave(): void {
    const ctx = this.options.getContext();
    if (!ctx) return;
    const fresh = ctx.save.reset();
    ctx.state.replace(fresh, 'debug-reset');
    this.afterCheat('reset-save', 'save wiped, default state restored');
  }

  toggleOverlay(): void {
    this.overlayVisible = !this.overlayVisible;
    this.afterCheat('toggle-overlay', this.overlayVisible ? 'shown' : 'hidden');
  }

  get isOverlayVisible(): boolean {
    return this.overlayVisible;
  }

  /* ------------------------------------------------------------ reporting */

  fps(): number | null {
    if (!this.game) return null;
    return Math.round(this.game.loop.actualFps);
  }

  stateSummary(): string {
    const ctx = this.options.getContext();
    if (!ctx) return 'debug: context unavailable';
    const state = ctx.state.state;
    const counts = ctx.buildings.getCounts();
    const saveStats = ctx.save.stats;

    return [
      `RESTORE IT! debug — v${ctx.config.appVersion}`,
      `platform: ${ctx.config.platform.isMobile ? 'mobile' : 'desktop'} | touch: ${ctx.config.platform.isTouch} | prod: ${ctx.config.platform.isProduction}`,
      `storage: ${ctx.save.storageName} | adapter: ${ctx.config.storage.adapter}`,
      `fps: ${this.fps() ?? 'n/a'}`,
      `coins: ${formatNumber(state.currencies.coins)} | gems: ${formatNumber(state.currencies.gems)}`,
      `income/s: ${formatNumber(ctx.buildings.getTotalIncomePerSecond())} | pending: ${formatNumber(ctx.buildings.pending)}`,
      `buildings: ${counts.unlocked}/${counts.total} unlocked, ${counts.restored} restored`,
      `stage: ${state.progression.currentStageId} | stages unlocked: ${state.progression.unlockedStageIds.length}`,
      `upgrades: ${ctx.upgrades.getActiveCount()} active, ${ctx.upgrades.getCompletedCount()} completed`,
      `timers: ${ctx.timers.getAll('running').length} running`,
      `save: #${saveStats.saveCount} at ${saveStats.lastSaveAt ? new Date(saveStats.lastSaveAt).toISOString() : 'never'}`,
      `lastSession: ${formatDuration(Math.max(0, ctx.clock.now() - state.timestamps.lastSessionTime))} ago`,
      `content: ${Object.entries(ctx.content.counts)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
      `offline: ${ctx.offline.summarize(ctx.offline.lastComputedReport)}`,
    ].join('\n');
  }

  private afterCheat(name: string, detail: string): void {
    const ctx = this.options.getContext();
    this.log.info(`cheat ${name}: ${detail}`);
    ctx?.events.emit('debug:cheat', { name, detail });
  }
}
