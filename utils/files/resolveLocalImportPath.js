import path from "node:path";
import { toRepoRelativePosix } from "./toRepoRelativePosix.js";
/**
 * @param {string} currentPath - repo-relative posix
 * @param {string} importSpecifier - as written in source (./ or ../)
 * @returns {string}
 */
export function resolveLocalImportPath(currentPath, importSpecifier) {
    const dir = path.posix.dirname(toRepoRelativePosix(currentPath));
    return toRepoRelativePosix(path.posix.join(dir, importSpecifier));
}