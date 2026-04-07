import { toRepoRelativePosix } from "./files/toRepoRelativePosix.js";
import { readFileWithSolFallback } from "./files/readFileWithSolFallback.js";
import { parseQuotedSolidityImports } from "./files/parseQuotedSolidityImports.js";
import { resolveLocalImportPath } from "./files/resolveLocalImportPath.js";
import { discoverImplementations } from "./files/discoverImplementations.js";

/**
 * @typedef {{ path: string, content: string, role: "entry" | "dependency" | "interface" | "implementation" }} PreparedFile
 */

/**
 * Recursively loads .sol files reachable via local (`./` / `../`) quoted imports.
 * BFS for deterministic order; skips already visited paths (cycles).
 * Optionally discovers implementation contracts for interfaces found in the closure.
 *
 * Also collects external (non-relative) import paths for context annotation.
 *
 * @param {object} opts
 * @param {string[]} opts.entryPaths - repo-relative paths (posix or native separators)
 * @param {(relPath: string) => Promise<string>} opts.readFile
 * @param {Map<string, string[]>} [opts.fileIndex] - optional pre-built file index for implementation discovery
 * @returns {Promise<{ files: PreparedFile[], externalImports: string[] }>}
 */
export async function prepareSolidityClosure({ entryPaths, readFile, fileIndex }) {
    const normalizedEntries = new Set(entryPaths.map((p) => toRepoRelativePosix(p)));
    const queue = [...normalizedEntries];
    const visited = new Set();
    /** @type {PreparedFile[]} */
    const ordered = [];
    /** @type {Set<string>} */
    const externalImportSet = new Set();

    while (queue.length > 0) {
      const rel = queue.shift();
      if (visited.has(rel)) continue;
      visited.add(rel);

      const content = await readFileWithSolFallback(readFile, rel);
      const role = normalizedEntries.has(rel) ? "entry" : classifyRole(rel, content);
      ordered.push({ path: rel, content, role });

      for (const spec of parseQuotedSolidityImports(content)) {
        if (!spec.startsWith("./") && !spec.startsWith("../")) {
          externalImportSet.add(spec);
          continue;
        }
        const next = resolveLocalImportPath(rel, spec);
        if (!visited.has(next)) queue.push(next);
      }
    }

    // Implementation discovery (if file index provided)
    if (fileIndex && fileIndex.size > 0) {
      const implPaths = discoverImplementations(ordered, fileIndex);
      for (const implPath of implPaths) {
        if (visited.has(implPath)) continue;
        visited.add(implPath);
        try {
          const content = await readFile(implPath);
          ordered.push({ path: implPath, content, role: "implementation" });

          // Also follow local imports from discovered implementations
          for (const spec of parseQuotedSolidityImports(content)) {
            if (!spec.startsWith("./") && !spec.startsWith("../")) {
              externalImportSet.add(spec);
              continue;
            }
            const next = resolveLocalImportPath(implPath, spec);
            if (!visited.has(next)) {
              visited.add(next);
              try {
                const depContent = await readFile(next);
                ordered.push({ path: next, content: depContent, role: classifyRole(next, depContent) });
              } catch { /* skip unresolvable transitive deps of implementations */ }
            }
          }
        } catch { /* skip unreadable implementation files */ }
      }
    }

    return { files: ordered, externalImports: [...externalImportSet] };
  }

/**
 * Classifies a file's role based on its path and content.
 * @param {string} filePath
 * @param {string} content
 * @returns {"interface" | "dependency"}
 */
function classifyRole(filePath, content) {
  const basename = filePath.split("/").pop();
  if (/^I[A-Za-z]/.test(basename) && /^\s*interface\s+\w+/m.test(content)) return "interface";
  if (/^\s*interface\s+\w+/m.test(content)) return "interface";
  return "dependency";
}
