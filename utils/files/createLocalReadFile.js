import path from "node:path";
import fs from "node:fs/promises";
import { toRepoRelativePosix } from "./toRepoRelativePosix.js";
/**
 * @param {string} repoRoot - absolute filesystem root of the repo
 * @returns {(relPath: string) => Promise<string>}
 */
export function createLocalReadFile(repoRoot) {
    const root = path.resolve(repoRoot);
    return async (relPath) => {
      const posix = toRepoRelativePosix(relPath);
      const abs = path.resolve(root, ...posix.split("/"));
      const rel = path.relative(root, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path escapes repo root: ${relPath}`);
      }
      return fs.readFile(abs, "utf8");
    };
  }