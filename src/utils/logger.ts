export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

export class StructuredLogger {
  private format(level: LogLevel, message: string, context?: Record<string, unknown>, err?: Error | unknown): string {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
      ...(err instanceof Error ? { error: err.message, stack: err.stack } : err ? { error: String(err) } : {})
    };
    return JSON.stringify(entry);
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.log(this.format('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>, err?: Error | unknown): void {
    console.warn(this.format('warn', message, context, err));
  }

  error(message: string, err?: Error | unknown, context?: Record<string, unknown>): void {
    console.error(this.format('error', message, context, err));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (process.env.DEBUG || process.env.NODE_ENV !== 'production') {
      console.log(this.format('debug', message, context));
    }
  }
}

export const logger = new StructuredLogger();
