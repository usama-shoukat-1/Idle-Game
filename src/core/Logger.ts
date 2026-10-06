/**
 * Tiny logging facade.
 *
 * Rules:
 * - Foundation systems log through `logger`, never `console.log` directly, so that
 *   release builds can silence them by changing one level.
 * - `LogLevel.Silent` is what a production build would use.
 */
export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
  Silent = 100,
}

export type LogChannel =
  | 'core'
  | 'scene'
  | 'save'
  | 'economy'
  | 'timer'
  | 'building'
  | 'upgrade'
  | 'progression'
  | 'offline'
  | 'ads'
  | 'purchase'
  | 'audio'
  | 'input'
  | 'ui'
  | 'debug'
  | 'content';

const CHANNEL_COLOURS: Partial<Record<LogChannel, string>> = {
  core: '#8fbcff',
  scene: '#7ee0d0',
  save: '#ffd479',
  economy: '#f2b544',
  timer: '#c79bff',
  ads: '#ff9db1',
};

export interface Logger {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  debug(channel: LogChannel, message: string, ...args: unknown[]): void;
  info(channel: LogChannel, message: string, ...args: unknown[]): void;
  warn(channel: LogChannel, message: string, ...args: unknown[]): void;
  error(channel: LogChannel, message: string, ...args: unknown[]): void;
  child(channel: LogChannel): Logger;
}

export class ConsoleLogger implements Logger {
  constructor(private level: LogLevel = LogLevel.Info) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(channel: LogChannel, message: string, ...args: unknown[]): void {
    this.write(LogLevel.Debug, channel, message, args, console.debug);
  }

  info(channel: LogChannel, message: string, ...args: unknown[]): void {
    this.write(LogLevel.Info, channel, message, args, console.info);
  }

  warn(channel: LogChannel, message: string, ...args: unknown[]): void {
    this.write(LogLevel.Warn, channel, message, args, console.warn);
  }

  error(channel: LogChannel, message: string, ...args: unknown[]): void {
    this.write(LogLevel.Error, channel, message, args, console.error);
  }

  /** Bound logger for a channel: `const log = logger.child('save')`. */
  child(channel: LogChannel): Logger {
    return {
      setLevel: (level) => this.setLevel(level),
      getLevel: () => this.getLevel(),
      debug: (m, ...a) => this.debug(channel, m, ...a),
      info: (m, ...a) => this.info(channel, m, ...a),
      warn: (m, ...a) => this.warn(channel, m, ...a),
      error: (m, ...a) => this.error(channel, m, ...a),
      child: (c) => this.child(c),
    };
  }

  private write(
    level: LogLevel,
    channel: LogChannel,
    message: string,
    args: unknown[],
    sink: (...data: unknown[]) => void,
  ): void {
    if (level < this.level) return;
    const colour = CHANNEL_COLOURS[channel] ?? '#9aa7b8';
    sink(`%c[${channel}]%c ${message}`, `color:${colour};font-weight:600`, 'color:inherit', ...args);
  }
}

export const logger: Logger = new ConsoleLogger();
