import { toRepoRelativePosix } from "./toRepoRelativePosix.js";

/**
 * @param {(relPath: string) => Promise<string>} readFile
 * @param {string} relPath - posix
 * @returns {Promise<string>}
 */
export async function readFileWithSolFallback(readFile, relPath) {
    const p = toRepoRelativePosix(relPath);
    try {
      return await readFile(p);
    } catch (err) {
      if (!p.endsWith(".sol")) {
        return await readFile(p + ".sol");
      }
      throw err;
    }
  }