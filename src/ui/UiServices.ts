import type { EventBus } from '@/core/events/EventBus';
import type { ServiceContainer } from '@/core/ServiceContainer';
import type { LayoutService } from '@/ui/layout/LayoutService';
import type { Screen } from '@/ui/components/Screen';

/**
 * The dependency bundle every screen/panel/popup receives.
 *
 * One object instead of a growing positional argument list: it keeps screens easy to
 * construct, makes the allowed dependencies obvious (events + systems + layout) and
 * documents what UI code must never touch (storage, save serialisation, scene internals).
 *
 * Layout is exposed through a getter rather than a snapshot because the viewport can
 * change at any time (rotation, browser chrome, keyboard).
 */
export interface UiServices {
  readonly events: EventBus;
  /** Systems bundle; UI calls public system APIs only. */
  readonly systems: ServiceContainer;
  /** The layout service: current metrics plus change notifications. */
  readonly layout: LayoutService;
  /** Push a modal above everything else in this scene. */
  readonly popups: PopupHost;
  /** Convenience accessors for the play frame in design units. */
  frameWidth(): number;
  frameHeight(): number;
}

/**
 * Popup hosting contract, implemented by UiRoot.
 * Screens open modals through this instead of touching the UI tree or the scene, so a
 * popup is always parented (and therefore scaled/laid out) correctly.
 */
export interface PopupHost {
  open(popup: Screen): void;
  close(popup: Screen): void;
  /** True while at least one modal is on screen (used to swallow world gestures). */
  isOpen(): boolean;
}

export function createUiServices(
  systems: ServiceContainer,
  layout: LayoutService,
  popups: PopupHost,
): UiServices {
  return {
    events: systems.events,
    systems,
    layout,
    popups,
    frameWidth: () => layout.metrics.frameUnits.width,
    frameHeight: () => layout.metrics.frameUnits.height,
  };
}
