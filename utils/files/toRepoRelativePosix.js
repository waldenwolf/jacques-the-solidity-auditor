import path from "node:path";
/**
 * @param {string} relPath
 * @returns {string}
 */
export function toRepoRelativePosix(relPath) {
    return path.posix.normalize(String(relPath).replace(/\\/g, "/"));
}