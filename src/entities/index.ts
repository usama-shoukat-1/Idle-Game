/**
 * Entities: lightweight logic facades over content definitions + saved state.
 * They never render and never own state, so both UI and simulation can use them.
 *
 * Phase 0 note: `WorkerEntity` and `CustomerEntity` are foundation-only - no worker
 * or customer content ships yet (business operations arrive after the first building).
 */

export { BuildingEntity } from './Building/BuildingEntity';
export type { BuildingEntityServices } from './Building/BuildingEntity';
export { WorkerEntity } from './Worker/WorkerEntity';
export type { WorkerDefinition } from './Worker/WorkerEntity';
export { CustomerEntity } from './Customer/CustomerEntity';
export type { CustomerPhase, CustomerTimeline } from './Customer/CustomerEntity';
