/**
 * LoadingScene.
 *
 * The "hydration" step: load + repair the save, sync content into state, catch up
 * timers from the offline window, compute the offline report and hand it to the
 * GameScene. This is deliberately a separate scene so the GameScene never has to
 * deal with save/offline concerns.
 */

import Phaser from 'phaser';
import { SCENE_KEYS } from '@/core/constants';
import { COLORS, HEX } from '@/ui/UiTheme';
import { createLabel } from '@/ui/components/Label';
import { ProgressBar } from '@/ui/components/ProgressBar';
import { centeredRect } from '@/ui/layout/Layout';
import type { Viewport } from '@/ui/layout/Viewport';
import type { OfflineReport } from '@/core/types/offline';
import { createLogger } from '@/core/utils/logger';
import { getGameContext, attachViewport, logSceneTransition, OFFLINE_REPORT_REGISTRY_KEY } from './sceneContext';

interface LoadStep {
  label: string;
  run: () => void;
}

export class LoadingScene extends Phaser.Scene {
  private readonly log = createLogger('loading');
  private viewport!: Viewport;
  private progressBar!: ProgressBar;
  private statusLabel!: Phaser.GameObjects.Text;
  private steps: LoadStep[] = [];
  private stepIndex = 0;

  constructor() {
    super({ key: SCENE_KEYS.loading });
  }

  create(): void {
    const context = getGameContext(this);
    const { viewport, dispose } = attachViewport(this);
    this.viewport = viewport;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);
    logSceneTransition(SCENE_KEYS.preload, SCENE_KEYS.loading, context);

    this.buildUi();
    this.steps = this.createSteps();
    this.runNextStep();
  }

  /** Ordered hydration steps. Each one is a small, testable unit of work. */
  private createSteps(): LoadStep[] {
    const context = getGameContext(this);

    return [
      {
        label: 'Reading save data',
        run: () => {
          if (!context.save.hasSave()) {
            this.log.info('no save found - starting a fresh state');
            return;
          }
          const result = context.save.load();
          if (result.state) context.state.replace(result.state, 'load');
          if (result.issues.length > 0) this.log.warn('save repaired on load', result.issues);
          if (!result.ok) {
            context.events.emit('ui:toast', {
              message: 'Save data was repaired from a damaged file',
              tone: 'warning',
            });
          }
        },
      },
      {
        label: 'Registering content',
        run: () => {
          context.buildings.syncFromContent();
        },
      },
      {
        label: 'Catching up timers',
        run: () => {
          context.offline.syncTimers();
        },
      },
      {
        label: 'Calculating offline progress',
        run: () => {
          const report = context.offline.computeReport();
          if (report && context.offline.shouldPresent(report)) {
            this.registry.set(OFFLINE_REPORT_REGISTRY_KEY, report);
            this.log.info(`offline report ready: ${context.offline.summarize(report)}`);
          } else {
            // Nothing worth showing: absorb the window so time is never credited twice.
            context.offline.absorb();
          }
        },
      },
      {
        label: 'Restoring systems',
        run: () => {
          context.state.update((state) => {
            state.stats.sessionsStarted += 1;
            state.timestamps.sessionStartedAt = context.clock.now();
          });
          context.progression.refreshUnlocks();
          context.progression.refreshStageProgress();
          context.audio.applySettings(context.state.state.settings);
          void context.ads.preload();
        },
      },
    ];
  }

  private runNextStep(): void {
    const step = this.steps[this.stepIndex];
    if (!step) {
      // A short beat so the player can read the last status; then into the menu.
      this.time.delayedCall(160, () => this.scene.start(SCENE_KEYS.mainMenu));
      return;
    }

    this.statusLabel.setText(step.label);
    this.progressBar.setProgress(this.stepIndex / Math.max(1, this.steps.length));

    try {
      step.run();
    } catch (error) {
      this.log.error(`load step "${step.label}" failed`, error);
      getGameContext(this).events.emit('ui:toast', {
        message: `Startup step failed: ${step.label}`,
        tone: 'error',
      });
    }

    this.stepIndex += 1;
    this.progressBar.setProgress(this.stepIndex / Math.max(1, this.steps.length));
    this.time.delayedCall(90, () => this.runNextStep());
  }

  private buildUi(): void {
    const viewport = this.viewport;
    const rect = centeredRect(viewport, 0.8, 0.2);

    this.statusLabel = createLabel(this, viewport, 'Preparing…', {
      size: 'md',
      color: HEX.text,
      align: 'center',
      origin: { x: 0.5, y: 0.5 },
    });
    this.statusLabel.setPosition(viewport.width / 2, viewport.height * 0.5);

    this.progressBar = new ProgressBar(
      this,
      {
        x: rect.x + rect.width * 0.1,
        y: Math.round(viewport.height * 0.56),
        width: rect.width * 0.8,
        height: Math.max(6, Math.round(viewport.height * 0.008)),
      },
      COLORS.accent,
    );

    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.statusLabel.setPosition(this.viewport.width / 2, this.viewport.height * 0.5);
    });
  }
}

/** Re-export so the GameScene can read the pending report without a magic string. */
export type { OfflineReport };
