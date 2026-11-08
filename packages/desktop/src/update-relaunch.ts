import type { EventEmitter } from "node:events";
import { app } from "electron";

/** Keep the local runtime recoverable until the native installer actually quits. */
export function waitForUpdateQuit(events: EventEmitter, install: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      events.removeListener("error", failed);
      app.removeListener("before-quit", quitting);
      if (error) reject(error);
      else resolve();
    };
    const failed = (error: Error) => finish(error);
    const quitting = () => finish();
    const timer = setTimeout(() => finish(new Error("The update installer did not restart Maket")), 5 * 60 * 1000);
    timer.unref();
    events.once("error", failed);
    app.once("before-quit", quitting);
    try {
      install();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
