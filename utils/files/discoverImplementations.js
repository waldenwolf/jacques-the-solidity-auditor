import path from "node:path";

/**
 * Given a set of resolved files (from BFS), discovers implementation contracts
 * for any interface files found. Uses I-prefix stripping and case-insensitive
 * file-index lookup.
 *
 * @param {Array<{ path: string, content: string }>} resolvedFiles - files from import BFS
 * @param {Map<string, string[]>} fileIndex - Map<lowercaseBasename, repoPosixPath[]>
 * @returns {string[]} repo-relative posix paths to discovered implementation files
 */
export function discoverImplementations(resolvedFiles, fileIndex) {
  const alreadyResolved = new Set(resolvedFiles.map((f) => f.path));
  /** @type {Set<string>} */
  const discovered = new Set();

  for (const file of resolvedFiles) {
    const basename = file.path.split("/").pop();

    // Strategy 1: I-prefix stripping on filenames (IFoo.sol -> Foo.sol)
    // Matches both IFoo.sol (I + uppercase) and IveRAAC.sol (I + lowercase for camelCase names)
    const isInterfaceFile = /^I[A-Za-z]/.test(basename) && isInterfaceContent(file.content);
    if (isInterfaceFile) {
      const stripped = basename.slice(1); // IFoo.sol -> Foo.sol, IveRAACToken.sol -> veRAACToken.sol
      searchAndAdd(stripped, fileIndex, alreadyResolved, discovered);

      // Also try with toggled first char case: veRAACToken.sol -> VeRAACToken.sol (or vice versa)
      const toggled = stripped.charAt(0) === stripped.charAt(0).toUpperCase()
        ? stripped.charAt(0).toLowerCase() + stripped.slice(1)
        : stripped.charAt(0).toUpperCase() + stripped.slice(1);
      if (toggled !== stripped) {
        searchAndAdd(toggled, fileIndex, alreadyResolved, discovered);
      }
    }

    // Strategy 2: parse "contract X is IFoo, IBar" from file content to find
    // what interfaces a contract inherits, then look for those interface implementations
    const inheritedInterfaces = parseInheritedInterfaces(file.content);
    for (const iface of inheritedInterfaces) {
      const ifaceSolFile = iface + ".sol";
      const implName = iface.startsWith("I") && iface.length > 1 && iface[1] === iface[1].toUpperCase()
        ? iface.slice(1) + ".sol"
        : null;
      if (implName) {
        searchAndAdd(implName, fileIndex, alreadyResolved, discovered);
        // Try uppercase variant
        const uppered = implName.charAt(0).toUpperCase() + implName.slice(1);
        if (uppered !== implName) {
          searchAndAdd(uppered, fileIndex, alreadyResolved, discovered);
        }
      }
    }

    // Strategy 3: look for Storage contracts (FooStorage.sol for Foo.sol)
    if (!basename.endsWith("Storage.sol") && !basename.startsWith("I")) {
      const storageName = basename.replace(".sol", "Storage.sol");
      searchAndAdd(storageName, fileIndex, alreadyResolved, discovered);
    }
  }

  return [...discovered];
}

/**
 * Case-insensitive search in the file index.
 * Adds matching paths to `discovered` if they aren't already resolved.
 *
 * @param {string} targetBasename
 * @param {Map<string, string[]>} fileIndex
 * @param {Set<string>} alreadyResolved
 * @param {Set<string>} discovered
 */
function searchAndAdd(targetBasename, fileIndex, alreadyResolved, discovered) {
  const key = targetBasename.toLowerCase();
  const candidates = fileIndex.get(key);
  if (!candidates) return;

  for (const candidate of candidates) {
    if (!alreadyResolved.has(candidate) && !discovered.has(candidate)) {
      discovered.add(candidate);
    }
  }
}

/**
 * Extracts interface names from `contract X is IFoo, IBar` declarations.
 *
 * @param {string} source
 * @returns {string[]}
 */
function parseInheritedInterfaces(source) {
  const RE = /(?:contract|abstract\s+contract)\s+\w+\s+is\s+([^{]+)\{/g;
  const interfaces = [];
  let m;
  while ((m = RE.exec(source)) !== null) {
    const parents = m[1].split(",").map((s) => s.trim());
    for (const parent of parents) {
      const name = parent.split(/[\s(]/)[0];
      if (name.startsWith("I") && name.length > 1) {
        interfaces.push(name);
      }
    }
  }
  return interfaces;
}

/**
 * Checks if file content looks like an interface (contains `interface ` keyword).
 * @param {string} content
 * @returns {boolean}
 */
function isInterfaceContent(content) {
  return /^\s*interface\s+\w+/m.test(content);
}

export { parseInheritedInterfaces };
