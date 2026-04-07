import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { findImportedContractsRecursive } from "../utils/files/findImportedContractsRecursive.js";
import { createLocalReadFile } from "../utils/files/createLocalReadFile.js";
import { parseQuotedSolidityImports } from "../utils/files/parseQuotedSolidityImports.js";
import { resolveLocalImportPath } from "../utils/files/resolveLocalImportPath.js";
import { toRepoRelativePosix } from "../utils/files/toRepoRelativePosix.js";
import { prepareSolidityClosure } from "../utils/prepareSolidityClosure.js";
import { formatContextMarkdown } from "../utils/formatContextMarkdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const treeFixtureRoot = path.join(__dirname, "fixtures", "solidity-tree");
const cycleFixtureRoot = path.join(__dirname, "fixtures", "cycle");

const TREE_FILES = [
  "contracts/core/Bank.sol",
  "contracts/core/BankReceiptToken.sol",
  "contracts/libraries/Math.sol",
  "contracts/libraries/ExtendedMath.sol",
];

async function buildContentMap(root, relPaths) {
  const map = new Map();
  for (const rel of relPaths) {
    const abs = path.join(root, ...rel.split("/"));
    map.set(rel, await fs.readFile(abs, "utf8"));
  }
  return map;
}

function createMapReadFile(map) {
  return async (relPath) => {
    const k = toRepoRelativePosix(relPath);
    if (map.has(k)) return map.get(k);
    if (!k.endsWith(".sol") && map.has(`${k}.sol`)) return map.get(`${k}.sol`);
    throw new Error(`missing file in map: ${k}`);
  };
}

describe("prepareFiles helpers", () => {
  it("parseQuotedSolidityImports finds bare imports", () => {
    const src = 'import "./Foo.sol";\nimport \'../Bar.sol\';';
    const im = parseQuotedSolidityImports(src);
    assert.ok(im.includes("./Foo.sol"));
    assert.ok(im.includes("../Bar.sol"));
  });

  it("parseQuotedSolidityImports finds named imports", () => {
    const src = 'import { Foo } from "./Foo.sol";\nimport { Bar } from "../Bar.sol";';
    const im = parseQuotedSolidityImports(src);
    assert.ok(im.includes("./Foo.sol"));
    assert.ok(im.includes("../Bar.sol"));
  });

  it("resolveLocalImportPath resolves relative to current file dir", () => {
    assert.equal(
      resolveLocalImportPath("contracts/core/Bank.sol", "../libraries/Math.sol"),
      "contracts/libraries/Math.sol",
    );
  });

  it("toRepoRelativePosix normalizes separators", () => {
    assert.equal(toRepoRelativePosix("a\\b/c.sol"), "a/b/c.sol");
  });
});

describe("prepareSolidityClosure", () => {
  it("includes transitive local imports for fixture tree", async () => {
    const readFile = createLocalReadFile(treeFixtureRoot);
    const { files } = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile,
    });
    const paths = files.map((f) => f.path);
    assert.equal(paths.length, 4);
    for (const p of TREE_FILES) {
      assert.ok(paths.includes(p), `expected ${p} in ${paths.join(", ")}`);
    }
  });

  it("returns the same order for identical inputs (deterministic)", async () => {
    const readFile = createLocalReadFile(treeFixtureRoot);
    const a = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile,
    });
    const b = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile,
    });
    assert.deepEqual(
      a.files.map((x) => x.path),
      b.files.map((x) => x.path),
    );
    assert.deepEqual(a, b);
  });

  it("terminates on circular local imports", async () => {
    const readFile = createLocalReadFile(cycleFixtureRoot);
    const { files } = await prepareSolidityClosure({
      entryPaths: ["A.sol"],
      readFile,
    });
    assert.equal(files.length, 2);
    const paths = new Set(files.map((f) => f.path));
    assert.ok(paths.has("A.sol"));
    assert.ok(paths.has("B.sol"));
  });

  it("matches in-memory readFile map output (local vs map parity)", async () => {
    const map = await buildContentMap(treeFixtureRoot, TREE_FILES);
    const local = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile: createLocalReadFile(treeFixtureRoot),
    });
    const mapped = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile: createMapReadFile(map),
    });
    assert.deepEqual(local, mapped);
  });
});

describe("formatContextMarkdown", () => {
  it("emits simple code blocks without perFile", () => {
    const md = formatContextMarkdown([
      { path: "a.sol", content: "pragma solidity ^0.8.20;\n" },
    ]);
    assert.match(md, /### File: a\.sol/);
    assert.match(md, /```solidity/);
    assert.match(md, /pragma solidity/);
  });

  it("emits prior version and diff when perFile and changedPathsInOrder are set", () => {
    const md = formatContextMarkdown(
      [
        { path: "contracts/x.sol", content: "contract X {}" },
        { path: "contracts/dep.sol", content: "library Dep {}" },
      ],
      {
        perFile: {
          "contracts/x.sol": { status: "modified", patch: "@@ -1 +1 @@" },
        },
        changedPathsInOrder: ["contracts/x.sol"],
      },
    );
    assert.match(md, /\*\*Prior version:\*\*/);
    assert.match(md, /\*\*Diff:\*\*/);
    assert.match(md, /```diff/);
    assert.match(md, /### File: contracts\/dep\.sol/);
    assert.match(md, /\*\*Code:\*\*/);
  });

  it("uses Code section for added files", () => {
    const md = formatContextMarkdown(
      [{ path: "new.sol", content: "contract N {}" }],
      {
        perFile: {
          "new.sol": { status: "added", patch: "diff here" },
        },
        changedPathsInOrder: ["new.sol"],
      },
    );
    assert.match(md, /\*\*Status:\*\* added/);
    assert.match(md, /\*\*Code:\*\*/);
    assert.match(md, /```diff\ndiff here/);
  });
});

describe("findImportedContractsRecursive", () => {
  it("delegates to prepareSolidityClosure and returns absolute paths", async () => {
    const entry = path.join(treeFixtureRoot, "contracts/core/Bank.sol");
    const set = await findImportedContractsRecursive(entry, treeFixtureRoot);
    assert.equal(set.size, 4);
    for (const rel of TREE_FILES) {
      const abs = path.resolve(treeFixtureRoot, ...rel.split("/"));
      assert.ok(set.has(abs), `missing ${abs}`);
    }
  });
});
