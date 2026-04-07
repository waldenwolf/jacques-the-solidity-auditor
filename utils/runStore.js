import fs from "node:fs";
import path from "node:path";

/**
 * Creates a run store that persists each pipeline step to a timestamped folder.
 * Each step is saved as a separate file so partial progress survives failures.
 *
 * @param {string} baseDir - project root (where tmp/runs lives)
 * @returns {RunStore}
 */
export function createRunStore(baseDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(baseDir, "tmp", "runs", ts);
  fs.mkdirSync(runDir, { recursive: true });
  return buildStore(runDir);
}

/**
 * Opens an existing run directory for resuming a prior run.
 * Provides the same interface as createRunStore plus has() and load().
 *
 * @param {string} runDir - absolute path to an existing run directory
 * @returns {RunStore}
 */
export function openRunStore(runDir) {
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`);
  }
  return buildStore(runDir);
}

/**
 * @typedef {object} RunStore
 * @property {string} runDir
 * @property {(step: string, data: any) => void} save
 * @property {(step: string) => boolean} has
 * @property {(step: string) => any} load
 * @property {(prefix: string) => string[]} list
 */

/**
 * @param {string} runDir
 * @returns {RunStore}
 */
function buildStore(runDir) {
  function resolvePath(step) {
    const mdPath = path.join(runDir, `${step}.md`);
    if (fs.existsSync(mdPath)) return mdPath;
    const jsonPath = path.join(runDir, `${step}.json`);
    if (fs.existsSync(jsonPath)) return jsonPath;
    return null;
  }

  return {
    runDir,

    save(step, data) {
      const ext = typeof data === "string" ? ".md" : ".json";
      const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      const filePath = path.join(runDir, `${step}${ext}`);
      fs.writeFileSync(filePath, content, "utf8");
    },

    has(step) {
      return resolvePath(step) !== null;
    },

    load(step) {
      const filePath = resolvePath(step);
      if (!filePath) throw new Error(`Step "${step}" not found in ${runDir}`);
      const raw = fs.readFileSync(filePath, "utf8");
      return filePath.endsWith(".json") ? JSON.parse(raw) : raw;
    },

    list(prefix) {
      return fs.readdirSync(runDir)
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.replace(/\.(md|json)$/, ""))
        .sort();
    },
  };
}
