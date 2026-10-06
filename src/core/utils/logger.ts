/**
 * Tiny namespaced logger. Debug logging is disabled in production builds and can
 * be toggled at runtime (`?debug=1`) through the debug tools.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

let globalLevel: LogLevel = import.meta.env?.PROD ? 'warn' : 'debug';

export function setGlobalLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
  return globalLevel;
}

export class Logger {
  constructor(private readonly namespace: string) {}

  child(namespace: string): Logger {
    return new Logger(`${this.namespace}:${namespace}`);
  }

  debug(...args: unknown[]): void {
    this.write('debug', args);
  }

  info(...args: unknown[]): void {
    this.write('info', args);
  }

  warn(...args: unknown[]): void {
    this.write('warn', args);
  }

  error(...args: unknown[]): void {
    this.write('error', args);
  }

  /** Always prints, even at `silent` - reserved for hard errors. */
  fatal(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.error(`[${this.namespace}]`, ...args);
  }

  private write(level: Exclude<LogLevel, 'silent'>, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;
    const method = level === 'debug' ? console.log : console[level];
    method.call(console, `[${this.namespace}]`, ...args);
  }
}

export function createLogger(namespace: string): Logger {
  return new Logger(namespace);
}
