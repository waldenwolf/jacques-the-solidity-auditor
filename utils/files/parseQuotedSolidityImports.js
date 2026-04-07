// Bare import:        import "./Foo.sol";
const BARE_IMPORT_RE = /import\s+["']([^"']+)["']\s*;/g;

// from-style import:  import { X } from "./Foo.sol";
//                     import * as X from "./Foo.sol";
//                     import { X, Y } from "./Foo.sol";
// Also handles multi-line:
//   import {
//     Foo,
//     Bar
//   } from "./Foo.sol";
const FROM_IMPORT_RE = /from\s+["']([^"']+)["']\s*;/g;

// Bare aliased import: import "./Foo.sol" as X;
const BARE_ALIAS_RE = /import\s+["']([^"']+)["']\s+as\s+\w+\s*;/g;


/**
 * Extracts all import paths from Solidity source code.
 * Handles bare, named (curly-brace), aliased, wildcard, and multi-line imports.
 *
 * @param {string} source
 * @returns {string[]} - unique import paths in order of first appearance
 */
export function parseQuotedSolidityImports(source) {
    const seen = new Set();
    const out = [];

    const collect = (re) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(source)) !== null) {
        const p = m[1].trim();
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    };

    collect(FROM_IMPORT_RE);
    collect(BARE_IMPORT_RE);
    collect(BARE_ALIAS_RE);

    return out;
  }
