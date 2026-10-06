/**
 * The single typed event map for the game.
 *
 * Systems talk to each other and to the UI through this map (never through
 * direct scene references), which keeps rendering decoupled from simulation.
 */

import type { BuildingId, DistrictId, MasteryTrackId, StageId, TimerId, UpgradeId } from './ids';
import type { CurrencyCost } from './content';
import type {
  CurrencyKind,
  TransactionErrorCode,
  TransactionReason,
  TransactionRecord,
} from './economy';
import type { SettingsState } from './gameState';
import type { OfflineReport } from './offline';
import type { RewardGrant, RewardedAdOutcome, PurchaseStatus } from './monetization';
import type { SaveInfo, SaveReason } from './save';
import type { TimerProgress, TimerState } from './timers';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface GameEventMap {
  /* ---------------------------------------------------------------- engine */
  'engine:ready': { at: number; version: string };
  'engine:shutdown': { at: number };
  'scene:changed': { from: string | null; to: string };

  /* ----------------------------------------------------------------- state */
  'state:replaced': { reason: string; at: number };
  'state:dirty': { at: number };

  /* --------------------------------------------------------------- economy */
  'economy:changed': { coins: number; gems: number; reason: TransactionReason; at: number };
  'economy:transaction': TransactionRecord;
  'economy:rejected': {
    currency: CurrencyKind;
    amount: number;
    reason: TransactionReason;
    code: TransactionErrorCode;
    message: string;
  };

  /* ---------------------------------------------------------------- timers */
  'timer:started': { timer: TimerState };
  'timer:paused': { timer: TimerState };
  'timer:resumed': { timer: TimerState };
  'timer:completed': { timer: TimerState };
  'timer:cancelled': { timer: TimerState; reason: string };
  'timer:progress': { timer: TimerState; progress: TimerProgress };

  /* ------------------------------------------------------------- buildings */
  'building:registered': { buildingId: BuildingId };
  'building:unlocked': { buildingId: BuildingId; at: number };
  'building:tier-changed': {
    buildingId: BuildingId;
    from: number;
    to: number;
    visualStateId: string;
  };
  'building:visual-state-changed': { buildingId: BuildingId; visualStateId: string };
  'building:income-accrued': { buildingId: BuildingId; coins: number; at: number };
  'building:income-flushed': {
    coins: number;
    breakdown: Record<BuildingId, number>;
    at: number;
  };

  /* -------------------------------------------------------------- upgrades */
  'upgrade:started': {
    upgradeId: UpgradeId;
    buildingId: BuildingId | null;
    timerId: TimerId | null;
    cost: CurrencyCost;
    endsAt: number;
  };
  'upgrade:completed': {
    upgradeId: UpgradeId;
    buildingId: BuildingId | null;
    tier: number;
    instant: boolean;
  };
  'upgrade:cancelled': {
    upgradeId: UpgradeId;
    buildingId: BuildingId | null;
    reason: string;
  };
  'upgrade:rejected': {
    upgradeId: UpgradeId;
    buildingId: BuildingId | null;
    code: string;
    message: string;
  };

  /* ----------------------------------------------------------- progression */
  'progression:stage-unlocked': { stageId: StageId; at: number };
  'progression:district-progress': {
    districtId: DistrictId;
    progress: number;
    restoredBuildings: number;
    totalBuildings: number;
  };
  'progression:mastery-gained': { trackId: MasteryTrackId; level: number; xp: number };

  /* ------------------------------------------------------------- savegame */
  'save:saved': { info: SaveInfo; reason: SaveReason };
  'save:loaded': { info: SaveInfo; migratedFrom: number | null };
  'save:reset': { at: number };
  'save:error': { message: string };

  /* --------------------------------------------------------------- offline */
  'offline:computed': { report: OfflineReport };
  'offline:claimed': { report: OfflineReport };

  /* --------------------------------------------------------- monetization */
  'reward:granted': { grant: RewardGrant; source: string; at: number };
  'ad:offered': { placementId: string; at: number };
  'ad:outcome': { placementId: string; outcome: RewardedAdOutcome; message?: string };
  'purchase:completed': { productId: string; status: PurchaseStatus; transactionId?: string };
  'purchase:failed': { productId: string; status: PurchaseStatus; message?: string };

  /* ----------------------------------------------------------------- audio */
  'audio:changed': { settings: SettingsState };

  /* ---------------------------------------------------------------- input */
  'input:tap': { x: number; y: number; worldX: number; worldY: number; pointerId: number };
  'input:drag': { x: number; y: number; dx: number; dy: number; pointerId: number };
  'input:drag-end': { x: number; y: number; pointerId: number };
  'input:swipe': { direction: 'up' | 'down' | 'left' | 'right'; velocity: number };
  'input:debug-key': { key: string };

  /* ------------------------------------------------------------------- ui */
  'ui:toast': { message: string; tone: ToastTone; durationMs?: number };
  'settings:changed': { settings: SettingsState };

  /* ---------------------------------------------------------------- debug */
  'debug:cheat': { name: string; detail?: string };
}
