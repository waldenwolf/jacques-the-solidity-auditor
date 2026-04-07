import fs from "node:fs";
import path from "node:path";

/**
 * Formats Anthropic API response metadata into a compact string.
 * @param {object} response - Anthropic message response
 * @returns {string}
 */
export function formatResponseMeta(response) {
  if (!response) return "no response";
  const parts = [];
  if (response.model) parts.push(`model=${response.model}`);
  if (response.stop_reason) parts.push(`stop=${response.stop_reason}`);
  if (response.usage) {
    parts.push(`in=${response.usage.input_tokens}`, `out=${response.usage.output_tokens}`);
  }
  return parts.join(", ");
}

/**
 * Creates a structured logger that writes to console and optionally to a
 * persistent log file inside the run directory.
 *
 * Levels:
 *  - info  — always printed (unless quiet), always saved to file
 *  - warn  — always printed (unless quiet), always saved to file
 *  - error — always printed, always saved to file
 *  - debug — only printed when verbose, always saved to file
 *
 * @param {object} [opts]
 * @param {boolean} [opts.verbose=false] - print debug-level messages to console
 * @param {boolean} [opts.quiet=false] - suppress info-level console output
 * @param {string}  [opts.runDir] - path to run directory for the log file
 * @returns {import('./logger.js').Logger}
 */
export function createLogger({ verbose = false, quiet = false, runDir = null } = {}) {
  const logFilePath = runDir ? path.join(runDir, "00-debug.log") : null;

  function appendToFile(line) {
    if (!logFilePath) return;
    try {
      fs.appendFileSync(logFilePath, line + "\n", "utf8");
    } catch {
      // best-effort — don't crash the pipeline over logging
    }
  }

  function formatFileLine(level, tag, message) {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase().padEnd(5)}] [${tag}] ${message}`;
  }

  return {
    info(tag, message) {
      if (!quiet) console.log(`[${tag}] ${message}`);
      appendToFile(formatFileLine("info", tag, message));
    },

    debug(tag, message) {
      if (verbose && !quiet) console.log(`[${tag}] ${message}`);
      appendToFile(formatFileLine("debug", tag, message));
    },

    warn(tag, message) {
      if (!quiet) console.warn(`[${tag}] ${message}`);
      appendToFile(formatFileLine("warn", tag, message));
    },

    error(tag, message) {
      console.error(`[${tag}] ${message}`);
      appendToFile(formatFileLine("error", tag, message));
    },

    get verbose() {
      return verbose;
    },
  };
}

/**
 * A no-op logger that silently discards all messages.
 * Used as default when no logger is provided.
 */
export const nullLogger = Object.freeze({
  info() {},
  debug() {},
  warn() {},
  error() {},
  verbose: false,
});
