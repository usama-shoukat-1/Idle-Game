import type { BuildingDefinition, RestorationTierDefinition, VisualStateDefinition } from '@/core/types/content';
import { MS_PER_MINUTE, asDurationMs, seconds } from '@/core/types/primitives';
import { BUILDING_IDS, STAGE_IDS } from '@/data/ids';

export { BUILDING_IDS } from '@/data/ids';

/**
 * OLD CAFÉ - the first playable building (Phase 1 vertical slice).
 * ===============================================================
 * This file is *content*: the whole restoration curve, its prices, durations and art
 * states. No system knows the café exists - BuildingSystem/UpgradeSystem/economy read
 * these generic fields, which is why adding the second building later is a data task.
 *
 * THE INCOME MODEL
 * ----------------
 * `baseIncome` is a neutral 1 coin/minute and each tier's `incomeMultiplier` is the
 * building's *absolute* income in coins per minute at that tier (tier multipliers are not
 * cumulative - see docs/DATA_MODEL.md). Keeping the table in one place means the numbers
 * below are literally the balance table from the Phase 1 brief:
 *
 *   tier   1    2    3    4     5     6     7      8      9      10
 *   coins/min  0   25   40   65   100   160   250    400    650    1050
 *
 * RESTORATION PHASES (visual direction)
 * -------------------------------------
 *   A Recovery (1-3):  debris cleared -> furniture repaired -> electricity restored
 *   B Opening  (4-6):  counter -> kitchen -> seating
 *   C Growth   (7-10): worker -> menu & service -> extension -> premium renovation
 */

/** Visual state keys, one per tier so every restoration step is visible on screen. */
export const OLD_CAFE_VISUAL_STATES = [
  'tier0',
  'tier1',
  'tier2',
  'tier3',
  'tier4',
  'tier5',
  'tier6',
  'tier7',
  'tier8',
  'tier9',
  'tier10',
] as const;

export type OldCafeVisualState = (typeof OLD_CAFE_VISUAL_STATES)[number];

/** One row of the balance table. Costs are coins; durations in ms (0 = instant). */
interface TierRow {
  readonly tier: number;
  readonly displayName: string;
  readonly detail: string;
  readonly cost: number;
  readonly durationMs: number;
  readonly incomePerMinute: number;
  readonly visualState: OldCafeVisualState;
}

export const OLD_CAFE_TIERS: readonly TierRow[] = [
  {
    tier: 1,
    displayName: 'Clear the debris',
    detail: 'Sweep out years of dust, broken chairs and rubbish.',
    cost: 75,
    durationMs: 0,
    incomePerMinute: 0,
    visualState: 'tier1',
  },
  {
    tier: 2,
    displayName: 'Repair the furniture',
    detail: 'Fix the tables and chairs so people can sit down again.',
    cost: 125,
    durationMs: 0,
    incomePerMinute: 25,
    visualState: 'tier2',
  },
  {
    tier: 3,
    displayName: 'Restore the electricity',
    detail: 'Rewire the lights and the sign — the café wakes up.',
    cost: 200,
    durationMs: seconds(10),
    incomePerMinute: 40,
    visualState: 'tier3',
  },
  {
    tier: 4,
    displayName: 'Repair the counter',
    detail: 'A working serving counter means you can take orders.',
    cost: 300,
    durationMs: seconds(20),
    incomePerMinute: 65,
    visualState: 'tier4',
  },
  {
    tier: 5,
    displayName: 'Restore the kitchen',
    detail: 'Install the espresso machine and get proper food moving.',
    cost: 500,
    durationMs: seconds(45),
    incomePerMinute: 100,
    visualState: 'tier5',
  },
  {
    tier: 6,
    displayName: 'Add seating',
    detail: 'More tables, more guests, more cups per hour.',
    cost: 800,
    durationMs: 2 * MS_PER_MINUTE,
    incomePerMinute: 160,
    visualState: 'tier6',
  },
  {
    tier: 7,
    displayName: 'Hire your first worker',
    detail: 'Someone behind the counter so the café runs without you.',
    cost: 1_250,
    durationMs: 5 * MS_PER_MINUTE,
    incomePerMinute: 250,
    visualState: 'tier7',
  },
  {
    tier: 8,
    displayName: 'Upgrade the menu',
    detail: 'New boards, better presentation, a queue at the door.',
    cost: 2_000,
    durationMs: 12 * MS_PER_MINUTE,
    incomePerMinute: 400,
    visualState: 'tier8',
  },
  {
    tier: 9,
    displayName: 'Expand the café',
    detail: 'Open the side room for a proper dining area.',
    cost: 3_250,
    durationMs: 25 * MS_PER_MINUTE,
    incomePerMinute: 650,
    visualState: 'tier9',
  },
  {
    tier: 10,
    displayName: 'Premium renovation',
    detail: 'The full restoration: warm light, plants and a café the street is proud of.',
    cost: 5_250,
    durationMs: 45 * MS_PER_MINUTE,
    incomePerMinute: 1_050,
    visualState: 'tier10',
  },
];

/** Tier 0 is the "as found" state: free, instant and earning nothing. */
function createTierZero(): RestorationTierDefinition {
  return {
    tier: 0,
    displayName: 'As found',
    cost: { currency: 'coins', amount: 0 },
    durationMs: asDurationMs(0),
    incomeMultiplier: 0,
    visualState: 'tier0',
    prerequisites: [],
    unlocks: [],
  };
}

function createTiers(): readonly RestorationTierDefinition[] {
  const tiers: RestorationTierDefinition[] = [createTierZero()];
  for (const row of OLD_CAFE_TIERS) {
    tiers.push({
      tier: row.tier,
      displayName: row.displayName,
      cost: { currency: 'coins', amount: row.cost },
      durationMs: asDurationMs(row.durationMs),
      // Absolute income multiplier for this tier (1 coin/min base × this value).
      incomeMultiplier: row.incomePerMinute,
      visualState: row.visualState,
      prerequisites: [],
      unlocks: [],
    });
  }
  return tiers;
}

/**
 * Visual state catalog. `layers` is empty on purpose: the café is drawn procedurally
 * (see `src/ui/art/CafeIllustration.ts`), so there are no texture files to map here.
 * When real art arrives it is registered in `layers` and nothing else changes.
 */
function createVisualStates(): readonly VisualStateDefinition[] {
  return OLD_CAFE_VISUAL_STATES.map((key, index) => ({
    key,
    layers: {},
    description: index === 0 ? 'Abandoned, boarded up and full of debris.' : OLD_CAFE_TIERS[index - 1]?.displayName,
  }));
}

export const BUILDING_OLD_CAFE: BuildingDefinition = {
  id: BUILDING_IDS.oldCafe,
  displayName: 'Old Café',
  description:
    'A tired neighbourhood café that has been shut for years. Bring it back one step at a time.',
  stageId: STAGE_IDS.oldNeighborhood,
  type: 'cafe',
  order: 0,
  /**
   * 1 coin/minute base: every tier multiplier is then literally "coins per minute at this
   * tier", which keeps the balance table readable and the maths exact.
   */
  baseIncome: { kind: 'perSecond', coinsPerSecond: 1 / 60 },
  restorationTiers: createTiers(),
  visualStates: createVisualStates(),
  // The first building is owned immediately: no unlock requirements, starts unlocked.
  unlockRequirements: [],
  startsUnlocked: true,
  synergyRules: [],
  placeholder: { tint: '#c98a54', iconKey: 'cafe' },
};
