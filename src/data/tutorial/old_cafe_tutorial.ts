import type { TutorialStepDefinition } from '@/core/types/content';

/**
 * PHASE 1 ONBOARDING - OLD CAFÉ
 * =============================
 * Seven short hints that teach the commercial core loop without a tutorial level:
 *
 *   1. here is the café          5. the next upgrade is worth saving for
 *   2. tap your first restore    6. upgrades take time (leave, come back)
 *   3. restore the second step   7. optional speed-up ad
 *   4. income starts
 *
 * `advanceOn` names a domain event, so the tutorial never contains gameplay logic and
 * reacts to what the player actually does. Steps without `advanceOn` are acknowledged
 * with the banner's "GOT IT" tap. Nothing blocks input - the banner can be skipped at
 * any time and the tutorial is content, not code.
 */
export const TUTORIAL_OLD_CAFE: readonly TutorialStepDefinition[] = [
  {
    id: 'tutorial.old_cafe.intro',
    message: 'This is the Old Café.',
    detail: 'It has been shut for years. Let’s bring it back to life.',
    requireAcknowledge: true,
    highlight: 'building',
  },
  {
    id: 'tutorial.old_cafe.first_restore',
    message: 'Tap RESTORE to clear the debris.',
    detail: 'The first two steps are instant — you will see the café change immediately.',
    advanceOn: 'upgrade:completed',
    advanceWhen: { tier: 1 },
    highlight: 'restore',
  },
  {
    id: 'tutorial.old_cafe.second_restore',
    message: 'Now repair the furniture.',
    detail: 'This is the step that starts earning coins: 25 a minute, even while you are away.',
    advanceOn: 'upgrade:completed',
    advanceWhen: { tier: 2 },
    highlight: 'restore',
  },
  {
    id: 'tutorial.old_cafe.income_started',
    message: 'The café is earning coins.',
    detail: 'Income collects automatically — you never have to tap to claim it.',
    requireAcknowledge: true,
    highlight: 'currency',
  },
  {
    id: 'tutorial.old_cafe.next_upgrade',
    message: 'Start the next restoration.',
    detail: 'Restoring the electricity takes 10 seconds. Longer steps take longer — that is the idle part.',
    advanceOn: 'upgrade:started',
    highlight: 'restore',
  },
  {
    id: 'tutorial.old_cafe.timers',
    message: 'Upgrades keep running while you are away.',
    detail: 'Close the game whenever you like: progress continues and offline earnings build up.',
    requireAcknowledge: true,
    highlight: 'timer',
  },
  {
    id: 'tutorial.old_cafe.speedup',
    message: 'In a hurry? You can watch an ad to speed up.',
    detail: 'Rewarded ads are always optional — they only ever run when you tap the button.',
    requireAcknowledge: true,
    highlight: 'ad',
  },
];
