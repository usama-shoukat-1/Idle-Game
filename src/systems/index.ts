/**
 * Barrel for the reusable simulation systems.
 *
 * NOTE: Phaser-bound modules are deliberately not re-exported here, so this barrel
 * stays importable from headless contexts (unit tests, tooling):
 *   - `systems/InputSystem` (wraps Phaser input; used by scenes)
 *   - `systems/AudioSystem/PhaserAudioProvider`
 * Import those from their own paths when a scene needs them.
 */
export * from './EventSystem';
export * from './ContentSystem';
export * from './SaveSystem';
export * from './EconomySystem';
export * from './TimerSystem';
export * from './BuildingSystem';
export * from './UpgradeSystem';
export * from './ProgressionSystem';
export * from './OfflineIncomeSystem';
export * from './AdRewardSystem';
export * from './PurchaseSystem';
export { AudioManager, NullAudioProvider } from './AudioSystem/AudioManager';
export type { AudioManagerDeps, AudioProvider, AudioBus, SoundDefinition } from './AudioSystem/AudioManager';
