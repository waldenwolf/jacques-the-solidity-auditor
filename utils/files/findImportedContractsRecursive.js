import path from "node:path";

import { prepareSolidityClosure } from "../prepareSolidityClosure.js";
import { createLocalReadFile } from "./createLocalReadFile.js";
import { toRepoRelativePosix } from "./toRepoRelativePosix.js";

/**
 * Recursively finds all local imported contracts reachable from an entry file.
 * Returns absolute filesystem paths (including the entry), for compatibility with earlier callers.
 *
 * @param {string} entryFilePath - Absolute or cwd-relative path to the entry .sol file
 * @param {string} [repoRoot] - Repository root; defaults to process.cwd()
 * @returns {Promise<Set<string>>}
 */
export async function findImportedContractsRecursive(
  entryFilePath,
  repoRoot = process.cwd(),
) {
  const root = path.resolve(repoRoot);
  const absEntry = path.resolve(entryFilePath);
  const rel = path.relative(root, absEntry);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Entry path is not under repo root: ${entryFilePath}`);
  }

  const entryPosix = toRepoRelativePosix(rel.split(path.sep).join("/"));
  const readFile = createLocalReadFile(root);
  const { files } = await prepareSolidityClosure({
    entryPaths: [entryPosix],
    readFile,
  });

  return new Set(
    files.map((f) => path.resolve(root, ...f.path.split("/"))),
  );
}
