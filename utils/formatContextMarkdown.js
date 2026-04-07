import { toRepoRelativePosix } from "./files/toRepoRelativePosix.js";
/** @typedef {{ path: string, content: string, role?: string }} PreparedFile */

const ROLE_LABELS = {
  entry: "Entry file (audit target)",
  dependency: "Dependency (imported)",
  interface: "Interface",
  implementation: "Implementation (discovered)",
};

/**
 * @param {PreparedFile[]} preparedFiles
 * @param {object} [options]
 * @param {Record<string, { status?: string, patch?: string | null }>} [options.perFile] - keyed by repo-relative posix path
 * @param {string[]} [options.changedPathsInOrder] - when using perFile, emit these paths first (e.g. PR file order)
 * @param {string[]} [options.externalImports] - non-relative imports that couldn't be resolved
 * @returns {string}
 */
export function formatContextMarkdown(preparedFiles, options = {}) {
    const perFile = options.perFile ?? null;
    const changedPathsInOrder = options.changedPathsInOrder ?? null;
    const externalImports = options.externalImports ?? null;

    const byPath = new Map(preparedFiles.map((f) => [f.path, f]));
    let out = "";
    const emitted = new Set();

    const roleTag = (file) => {
      const label = ROLE_LABELS[file.role] ?? null;
      return label ? `**Role:** ${label}\n` : "";
    };

    const emitSimple = (file) => {
      out += `### File: ${file.path}\n${roleTag(file)}**Code:**\n\`\`\`solidity\n${file.content}\n\`\`\`\n\n---\n\n`;
      emitted.add(file.path);
    };

    const emitWithPrMeta = (file) => {
      const meta = perFile[file.path];
      const status = meta?.status ?? "unknown";
      const patch = meta.patch ?? "No diff available";

      if (status === "added") {
        out += `### File: ${file.path}\n${roleTag(file)}**Status:** ${status}\n\n**Code:**\n\`\`\`solidity\n${file.content}\n\`\`\`\n\n**Diff:**\n\`\`\`diff\n${patch}\n\`\`\`\n\n---\n\n`;
      } else {
        out += `### File: ${file.path}\n${roleTag(file)}**Status:** ${status}\n\n**Prior version:**\n\`\`\`solidity\n${file.content}\n\`\`\`\n\n**Diff:**\n\`\`\`diff\n${patch}\n\`\`\`\n\n---\n\n`;
      }
      emitted.add(file.path);
    };

    if (perFile && changedPathsInOrder) {
      for (const p of changedPathsInOrder) {
        const posix = toRepoRelativePosix(p);
        if (!perFile[posix]) continue;
        const file = byPath.get(posix);
        if (file) emitWithPrMeta(file);
      }
      for (const file of preparedFiles) {
        if (!emitted.has(file.path)) emitSimple(file);
      }
      if (externalImports?.length) out += formatExternalImports(externalImports);
      return out;
    }

    if (perFile) {
      const prPaths = new Set(Object.keys(perFile));
      for (const file of preparedFiles) {
        if (prPaths.has(file.path)) emitWithPrMeta(file);
      }
      for (const file of preparedFiles) {
        if (!emitted.has(file.path)) emitSimple(file);
      }
      if (externalImports?.length) out += formatExternalImports(externalImports);
      return out;
    }

    for (const file of preparedFiles) emitSimple(file);
    if (externalImports?.length) out += formatExternalImports(externalImports);
    return out;
  }

/**
 * @param {string[]} imports
 * @returns {string}
 */
function formatExternalImports(imports) {
  let section = "### External Dependencies (not included in context)\n";
  section += "The following external packages are imported but their source is not included:\n";
  for (const imp of imports) {
    section += `- \`${imp}\`\n`;
  }
  section += "\n---\n\n";
  return section;
}
