import { readRemoteContentFile } from "./readRemoteContentFile.js";
import { toRepoRelativePosix } from "./toRepoRelativePosix.js";
/**
 * @param {*} octokit - Octokit instance from @actions/github getOctokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @returns {(relPath: string) => Promise<string>}
 */
export function createRemoteReadFile(octokit, owner, repo, ref) {
    return (relPath) =>
      readRemoteContentFile(
        octokit,
        owner,
        repo,
        toRepoRelativePosix(relPath),
        ref,
      );
  }
  