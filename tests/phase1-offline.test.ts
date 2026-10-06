import { describe, expect, it } from 'vitest';

import { MS_PER_HOUR, MS_PER_MINUTE } from '@/core/types/primitives';
import { AD_PLACEMENTS } from '@/core/ServiceContainer';
import { SAVE_KEYS } from '@/systems/SaveSystem/SaveSchema';
import {
  OLD_CAFE_ID,
  cafeUpgrade,
  createPhase1Environment,
  enterGame,
  reopenSession,
  restoreUpTo,
  type TestEnvironment,
} from './helpers/TestEnvironment';

/**
 * PHASE 1 - OFFLINE PROGRESSION
 * =============================
 * Offline income is the part of an idle game that is easiest to get wrong, so it is tested
 * hard: the cap, the exact number from the brief, the pending-not-paid model, the doubling
 * ad, duplicate-collection guards, clock tampering and corrupt saves.
 */

const MINUTE = MS_PER_MINUTE;
const HOUR = MS_PER_HOUR;

/** Session 1: restore the café, save, and "close the game". */
function playAndClose(tiers: number, now = 1_700_000_000_000): TestEnvironment {
  const env = createPhase1Environment({ now });
  enterGame(env);
  restoreUpTo(env, tiers);
  env.systems.save.save('test.close');
  env.dispose();
  return env;
}

describe('Phase 1 - offline configuration', () => {
  it('pays 100% of the rate, caps at 4 hours and ignores absences under a minute', () => {
    const env = createPhase1Environment();
    const balance = env.systems.content.getEconomyBalance().offline;

    expect(balance.efficiency).toBe(1);
    expect(balance.maxDurationMs).toBe(4 * HOUR);
    expect(balance.minimumDurationMs).toBe(MINUTE);
    env.dispose();
  });
});

describe('Phase 1 - offline earnings', () => {
  it('pays the brief example: tier 6 x 60 minutes = 9,600 coins', () => {
    const first = playAndClose(6);

    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    env.systems.buildings.ensureDefaultUnlocks();
    const summary = env.systems.offline.settle();

    expect(env.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(160, 6);
    expect(summary.skipped).toBe(false);
    expect(summary.effectiveElapsedMs).toBe(60 * MINUTE);
    expect(summary.capped).toBe(false);
    expect(summary.coins).toBe(9_600);

    // Calculated, not granted: the wallet only moves on collect.
    const pending = env.systems.offline.getPending()!;
    expect(pending.coins).toBe(9_600);
    expect(pending.perBuilding[0]!.buildingId).toBe(OLD_CAFE_ID);
    expect(env.systems.offline.hasPending()).toBe(true);

    const collected = env.systems.offline.collect();
    expect(collected).toBe(9_600);
    expect(env.systems.offline.hasPending()).toBe(false);
    expect(env.systems.offline.collect()).toBe(0); // never twice

    env.dispose();
  });

  it('clamps a long absence to the 4 hour cap and never pays the uncapped amount', () => {
    const first = playAndClose(10); // 1,050 coins/min
    const away = 10 * HOUR;

    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + away });
    env.systems.buildings.ensureDefaultUnlocks();
    const summary = env.systems.offline.settle();

    expect(summary.capped).toBe(true);
    expect(summary.elapsedMs).toBe(away);
    expect(summary.effectiveElapsedMs).toBe(4 * HOUR);
    expect(summary.coins).toBe(1_050 * 60 * 4); // 252,000
    expect(env.systems.offline.getPending()!.capped).toBe(true);

    env.dispose();
  });

  it('uses the live income rate, including an active 2x boost', () => {
    const first = playAndClose(6); // 160/min
    const reopened = createPhase1Environment({
      storage: first.storage,
      now: first.clock.now() + 30 * MINUTE,
    });
    reopened.systems.buildings.ensureDefaultUnlocks();
    reopened.systems.boosts.apply({
      id: 'test.boost',
      kind: 'incomeMultiplier',
      amount: 2,
      durationMs: 30 * MINUTE,
      source: 'test',
      label: '2x',
    });

    const summary = reopened.systems.offline.settle();
    // 160/min doubled for 30 minutes.
    expect(summary.coins).toBe(160 * 2 * 30);

    // ...and the boost is still respected by live income afterwards.
    expect(reopened.systems.buildings.getIncomeRatePerMs(OLD_CAFE_ID) * 60_000).toBeCloseTo(320, 6);

    reopened.dispose();
  });

  it('ignores an absence shorter than the minimum window', () => {
    const first = playAndClose(6);
    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 30_000 });

    const summary = env.systems.offline.settle();
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('too-short');
    expect(env.systems.offline.hasPending()).toBe(false);
    env.dispose();
  });

  it('does not offer offline earnings on a fresh save', () => {
    const env = createPhase1Environment();
    enterGame(env);

    const summary = env.systems.offline.settle();
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('fresh-session');
    expect(env.systems.offline.getPending()).toBeNull();
    env.dispose();
  });
});

describe('Phase 1 - offline durability', () => {
  it('shows the same reward when the game is reloaded before collecting', () => {
    const first = playAndClose(6);

    const second = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    second.systems.buildings.ensureDefaultUnlocks();
    second.systems.offline.settle();
    expect(second.systems.offline.getPending()!.coins).toBe(9_600);
    second.systems.save.save('test.pending-uncollected');
    second.dispose();

    // Ten more minutes pass with the reward still uncollected.
    const third = createPhase1Environment({ storage: second.storage, now: second.clock.now() + 10 * MINUTE });
    third.systems.buildings.ensureDefaultUnlocks();
    third.systems.offline.settle();

    // The earlier reward is never lost; the extra 10 minutes at 160/min is added on top.
    const pending = third.systems.offline.getPending()!;
    expect(pending.coins).toBe(9_600 + 1_600);
    expect(pending.effectiveElapsedMs).toBe(70 * MINUTE);
    expect(third.systems.offline.collect()).toBe(11_200);

    third.dispose();
  });

  it('doubles the pending reward once, through the offline ad placement', async () => {
    const first = playAndClose(6);
    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    env.systems.buildings.ensureDefaultUnlocks();
    env.systems.offline.settle();
    await env.systems.ads.initialize();

    const reward = env.systems.ads.findOffered('offlineBoost')!;
    expect(reward.id).toBe('reward.offline_double');
    expect(env.systems.ads.previewAmount(reward.id)).toBe(9_600); // extra coins gained

    const outcome = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.offlineDouble,
      rewardId: reward.id,
    });
    expect(outcome.status).toBe('granted');
    expect(env.systems.offline.getPending()!.coins).toBe(19_200);
    expect(env.systems.offline.getPending()!.boosted).toBe(true);

    // Idempotent: a second attempt is refused and the reward is not doubled again.
    expect(env.systems.ads.isOffered(reward.id)).toBe(false);
    const again = await env.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.offlineDouble,
      rewardId: reward.id,
    });
    expect(again.status).toBe('no-target');
    expect(env.systems.offline.getPending()!.coins).toBe(19_200);
    expect(env.systems.offline.collect()).toBe(19_200);

    env.dispose();
  });

  it('keeps a doubled reward doubled across a reload', async () => {
    const first = playAndClose(6);
    const second = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    second.systems.buildings.ensureDefaultUnlocks();
    second.systems.offline.settle();
    await second.systems.ads.initialize();
    await second.systems.ads.requestReward({
      placementId: AD_PLACEMENTS.offlineDouble,
      rewardId: 'reward.offline_double',
    });
    second.systems.save.save('test.boosted-pending');
    second.dispose();

    const third = createPhase1Environment({ storage: second.storage, now: second.clock.now() + 1_000 });
    third.systems.buildings.ensureDefaultUnlocks();
    third.systems.offline.settle();

    const pending = third.systems.offline.getPending()!;
    expect(pending.boosted).toBe(true);
    expect(pending.coins).toBeGreaterThanOrEqual(19_200);
    expect(third.systems.offline.collect()).toBe(pending.coins);

    third.dispose();
  });

  it('never double-counts the offline window as live income', () => {
    const first = playAndClose(6);
    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    env.systems.buildings.ensureDefaultUnlocks();
    env.systems.offline.settle();

    // The income anchors moved to "now" while calculating, so a live accrual immediately
    // after settling pays nothing for the offline window.
    const live = env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.live' });
    expect(live.coins).toBe(0);
    expect(env.systems.offline.collect()).toBe(9_600);

    // ...and collecting still does not trigger any live payout.
    expect(env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.live' }).coins).toBe(0);

    env.dispose();
  });

  it('stays safe when the device clock moves backwards', () => {
    const first = playAndClose(6);
    // A save written "in the future" relative to the new session clock.
    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() - 2 * HOUR });
    env.systems.buildings.ensureDefaultUnlocks();

    const summary = env.systems.offline.settle();
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('clock-backwards');
    expect(summary.coins).toBe(0);
    expect(env.systems.offline.getPending()).toBeNull();
    // Live income re-anchors instead of paying out negative time.
    expect(env.systems.buildings.accrueIncome(OLD_CAFE_ID, { reason: 'test.live' }).coins).toBe(0);
    expect(env.systems.economy.getCoins()).toBeGreaterThanOrEqual(0);

    env.dispose();
  });

  it('survives a corrupted save without crashing or paying', () => {
    const first = playAndClose(6);
    const raw = first.storage.read(SAVE_KEYS.save)!;
    // Truncate the JSON and remove a brace - a partial write / disk corruption.
    first.storage.write(SAVE_KEYS.save, raw.slice(0, Math.floor(raw.length * 0.7)));

    const env = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    env.systems.buildings.ensureDefaultUnlocks();
    const summary = env.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.coins).toBe(0);
    expect(env.systems.offline.hasPending()).toBe(false);

    env.dispose();
  });

  it('drops an implausible timestamp instead of paying an absurd reward', () => {
    const first = playAndClose(6);
    const raw = JSON.parse(first.storage.read(SAVE_KEYS.save)!) as {
      session?: { lastSaveAt?: number };
      analytics?: { lastSessionAt?: number };
    };
    // Year 3025: a classic "player set the clock forward" tamper.
    if (raw.session) raw.session.lastSaveAt = 33_300_000_000_000;
    if (raw.analytics) raw.analytics.lastSessionAt = 33_300_000_000_000;
    first.storage.write(SAVE_KEYS.save, JSON.stringify(raw));

    const env = createPhase1Environment({ storage: first.storage, now: 1_700_000_000_000 });
    const summary = env.systems.offline.settle();

    expect(summary.coins).toBe(0);
    expect(summary.skipped).toBe(true);
    expect(env.systems.offline.getPending()).toBeNull();

    env.dispose();
  });

  it('pays the whole absence at the tier the café is restored to on return', () => {
    // An upgrade finishing while the game is closed is applied on load, BEFORE the offline
    // maths. The absent span is then paid at the restored (higher) rate rather than being
    // lost by the income re-anchor. Documented approximation: it rounds in the player's
    // favour, never against them, and it is bounded by one tier step at most for the
    // fraction of the window before the completion.
    const first = createPhase1Environment();
    enterGame(first);
    restoreUpTo(first, 2); // 25/min
    first.systems.upgrades.start(cafeUpgrade(3)); // 10 seconds, 40/min on completion
    first.systems.save.save('test.close-mid-upgrade');
    const closedAt = first.clock.now();
    first.dispose();

    const env = createPhase1Environment({ storage: first.storage, now: closedAt + 60 * MINUTE });
    const rehydrated = env.systems.upgrades.rehydrate();
    expect(rehydrated.completedOffline).toBe(1);
    expect(env.systems.buildings.getTier(OLD_CAFE_ID)).toBe(3);

    env.systems.buildings.ensureDefaultUnlocks();
    const summary = env.systems.offline.settle();
    expect(summary.coins).toBe(40 * 60); // 60 minutes at the returned tier's 40/min
    expect(env.systems.offline.collect()).toBe(2_400);

    env.dispose();
  });

  it('does not count the same interval twice after a collect + reload', () => {
    const first = playAndClose(6);
    const second = createPhase1Environment({ storage: first.storage, now: first.clock.now() + 60 * MINUTE });
    second.systems.buildings.ensureDefaultUnlocks();
    second.systems.offline.settle();
    expect(second.systems.offline.collect()).toBe(9_600);
    second.systems.save.save('test.collected');
    second.dispose();

    const third = reopenSession(second, second.clock.now() + 1_000);
    third.systems.buildings.ensureDefaultUnlocks();
    const summary = third.systems.offline.settle();

    expect(summary.skipped).toBe(true);
    expect(summary.coins).toBe(0);
    expect(third.systems.offline.getPending()).toBeNull();
    expect(third.systems.economy.getCoins()).toBe(second.systems.economy.getCoins());

    third.dispose();
  });

  it('does not pay an absence while the previous session was still running', () => {
    // Same process, no reload: settling twice must not invent income.
    const env = createPhase1Environment();
    enterGame(env);
    restoreUpTo(env, 6);
    const wallet = env.systems.economy.getCoins();

    env.clock.advance(60 * MINUTE);
    const firstSettle = env.systems.offline.settle();
    expect(firstSettle.skipped).toBe(true); // fresh session: nothing to pay

    env.systems.save.save('test.running');
    env.clock.advance(60 * MINUTE);
    const secondSettle = env.systems.offline.settle();
    expect(secondSettle.skipped).toBe(true);
    expect(env.systems.economy.getCoins()).toBe(wallet); // unchanged wallet

    env.dispose();
  });
});
