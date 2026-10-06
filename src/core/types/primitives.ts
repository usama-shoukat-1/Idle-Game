/**
 * Branded primitive helpers.
 *
 * Timestamps and IDs are plain numbers/strings at runtime, but mixing them up is a
 * classic idle-game bug (e.g. treating a duration as an epoch, or double-multiplying
 * seconds and milliseconds). Branding makes those mistakes compile errors at zero
 * runtime cost.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Epoch milliseconds since 1 Jan 1970 UTC. */
export type EpochMs = Brand<number, 'EpochMs'>;
/** A duration in milliseconds (>= 0 by construction when produced by helpers). */
export type DurationMs = Brand<number, 'DurationMs'>;

export type BuildingId = Brand<string, 'BuildingId'>;
export type UpgradeId = Brand<string, 'UpgradeId'>;
export type StageId = Brand<string, 'StageId'>;
export type WorkerId = Brand<string, 'WorkerId'>;

export const asEpochMs = (value: number): EpochMs => value as EpochMs;
export const asDurationMs = (value: number): DurationMs => value as DurationMs;

export const buildingId = (value: string): BuildingId => value as BuildingId;
export const upgradeId = (value: string): UpgradeId => value as UpgradeId;
export const stageId = (value: string): StageId => value as StageId;
export const workerId = (value: string): WorkerId => value as WorkerId;

/** Milliseconds in one second / minute / hour / day - use instead of magic numbers. */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const seconds = (value: number): DurationMs => asDurationMs(value * MS_PER_SECOND);
export const minutes = (value: number): DurationMs => asDurationMs(value * MS_PER_MINUTE);
export const hours = (value: number): DurationMs => asDurationMs(value * MS_PER_HOUR);
export const days = (value: number): DurationMs => asDurationMs(value * MS_PER_DAY);

/** Currency kinds the economy understands. Extend here, nowhere else. */
export const CURRENCIES = ['coins', 'gems'] as const;
export type CurrencyId = (typeof CURRENCIES)[number];

/** Reason tag attached to every currency mutation - used for analytics + debugging. */
export type TransactionReason = string;
