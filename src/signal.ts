import { red, yellow } from "ansis";
import { MaybePromise, TerminationError } from "@forest-protocols/sdk";

export type CleanupHandler = <T>() => MaybePromise<T | void>;

export const abortController = new AbortController();
export let cleanupHandlers: CleanupHandler[] = [];

export function addCleanupHandler(handler: CleanupHandler) {
  cleanupHandlers.push(handler);
}

export function removeCleanupHandler(handler: CleanupHandler) {
  cleanupHandlers = cleanupHandlers.filter((h) => h !== handler);
}

["SIGINT", "SIGTERM"].forEach((signal) =>
  process.on(signal, () => {
    if (!abortController.signal.aborted) {
      console.error(yellow("[WARNING] Termination signal received"));
      process.exitCode = 1;
      abortController.abort(new TerminationError());
    } else {
      console.error(red("[ERROR] Force exit"));
      // Force close on the second attempt
      process.exit(255);
    }
  })
);
