/**
 * Branded-ish identifier aliases.
 *
 * Content is data-driven, so ids stay plain strings at runtime; the aliases keep
 * intent readable (`BuildingId` vs `UpgradeId`) without forcing casts on content
 * authors. Unknown ids are validated at the content-registry boundary instead.
 */

export type BuildingId = string;
export type UpgradeId = string;
export type StageId = string;
export type DistrictId = string;
export type WorkerId = string;
export type CustomerId = string;
export type TimerId = string;
export type EventId = string;
export type MasteryTrackId = string;
export type AdPlacementId = string;
export type ProductId = string;
export type EntitlementId = string;
export type BalanceId = string;
