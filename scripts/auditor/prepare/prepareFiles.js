import { prepareSolidityClosure } from "../../../utils/prepareSolidityClosure.js";
import { formatContextMarkdown } from "../../../utils/formatContextMarkdown.js";
import { createLocalReadFile } from "../../../utils/files/createLocalReadFile.js";
import { createRemoteReadFile } from "../../../utils/files/createRemoteReadFile.js";
import { toRepoRelativePosix } from "../../../utils/files/toRepoRelativePosix.js";
import { buildLocalFileIndex, buildRemoteFileIndex } from "../../../utils/files/buildFileIndex.js";

export {
  prepareSolidityClosure,
  formatContextMarkdown,
  createLocalReadFile,
  createRemoteReadFile,
  toRepoRelativePosix,
  buildLocalFileIndex,
  buildRemoteFileIndex,
};

/**
 * @typedef {{ path: string, content: string, role?: string }} PreparedFile
 *
 * @param {object} opts
 * @param {string[]} opts.entryPaths - repo-relative paths to seed files
 * @param {(relPath: string) => Promise<string>} opts.readFile
 * @param {Map<string, string[]>} [opts.fileIndex] - pre-built file index for implementation discovery
 * @param {Record<string, { status?: string, patch?: string | null }>} [opts.perFile]
 * @param {string[]} [opts.changedPathsInOrder]
 * @returns {Promise<{ preparedFiles: PreparedFile[], contextMarkdown: string, externalImports: string[] }>}
 */
export async function prepareFiles({
  entryPaths,
  readFile,
  fileIndex,
  perFile,
  changedPathsInOrder,
}) {
  const { files: preparedFiles, externalImports } = await prepareSolidityClosure({
    entryPaths,
    readFile,
    fileIndex,
  });
  const contextMarkdown = formatContextMarkdown(preparedFiles, {
    perFile,
    changedPathsInOrder,
    externalImports,
  });
  return { preparedFiles, contextMarkdown, externalImports };
}
