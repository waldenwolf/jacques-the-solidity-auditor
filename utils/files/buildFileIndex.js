import fs from "node:fs/promises";
import path from "node:path";
import { toRepoRelativePosix } from "./toRepoRelativePosix.js";

/**
 * Walks a local repo directory and builds a case-insensitive index of .sol files.
 *
 * @param {string} repoRoot - absolute path to repo root
 * @returns {Promise<Map<string, string[]>>} Map<lowercaseBasename, repoPosixPath[]>
 */
export async function buildLocalFileIndex(repoRoot) {
  const root = path.resolve(repoRoot);
  /** @type {Map<string, string[]>} */
  const index = new Map();

  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".sol")) continue;

    const parentPath = entry.parentPath ?? entry.path;
    const abs = path.join(parentPath, entry.name);
    const rel = path.relative(root, abs);
    const posix = toRepoRelativePosix(rel);
    const key = entry.name.toLowerCase();

    const existing = index.get(key);
    if (existing) {
      existing.push(posix);
    } else {
      index.set(key, [posix]);
    }
  }

  return index;
}

/**
 * Builds a file index from a GitHub tree API response (remote mode).
 *
 * @param {*} octokit - Octokit instance
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref - commit SHA or branch
 * @returns {Promise<Map<string, string[]>>} Map<lowercaseBasename, repoPosixPath[]>
 */
export async function buildRemoteFileIndex(octokit, owner, repo, ref) {
  /** @type {Map<string, string[]>} */
  const index = new Map();

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref,
    recursive: "true",
  });

  for (const item of data.tree) {
    if (item.type !== "blob") continue;
    if (!item.path.endsWith(".sol")) continue;

    const basename = item.path.split("/").pop();
    const key = basename.toLowerCase();
    const posix = toRepoRelativePosix(item.path);

    const existing = index.get(key);
    if (existing) {
      existing.push(posix);
    } else {
      index.set(key, [posix]);
    }
  }

  return index;
}
