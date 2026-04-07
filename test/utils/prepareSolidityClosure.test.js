import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareSolidityClosure } from "../../utils/prepareSolidityClosure.js";
import { createLocalReadFile } from "../../utils/files/createLocalReadFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const treeRoot = path.join(__dirname, "..", "fixtures", "solidity-tree");
const cycleRoot = path.join(__dirname, "..", "fixtures", "cycle");

describe("prepareSolidityClosure", () => {
  it("collects all transitive local imports", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile: createLocalReadFile(treeRoot),
    });
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("contracts/core/Bank.sol"));
    assert.ok(paths.includes("contracts/libraries/Math.sol"));
    assert.ok(paths.includes("contracts/core/BankReceiptToken.sol"));
    assert.ok(paths.includes("contracts/libraries/ExtendedMath.sol"));
    assert.equal(paths.length, 4);
  });

  it("deduplicates shared dependencies", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol", "contracts/core/BankReceiptToken.sol"],
      readFile: createLocalReadFile(treeRoot),
    });
    const pathSet = new Set(files.map((f) => f.path));
    assert.equal(pathSet.size, files.length, "should have no duplicates");
  });

  it("handles circular imports without hanging", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["A.sol"],
      readFile: createLocalReadFile(cycleRoot),
    });
    assert.equal(files.length, 2);
  });

  it("is deterministic", async () => {
    const rf = createLocalReadFile(treeRoot);
    const a = await prepareSolidityClosure({ entryPaths: ["contracts/core/Bank.sol"], readFile: rf });
    const b = await prepareSolidityClosure({ entryPaths: ["contracts/core/Bank.sol"], readFile: rf });
    assert.deepEqual(a, b);
  });

  it("BFS order: entry first, then breadth-first dependencies", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile: createLocalReadFile(treeRoot),
    });
    assert.equal(files[0].path, "contracts/core/Bank.sol");
  });

  it("skips non-local imports and collects them as external", async () => {
    const readFile = async (p) => {
      if (p === "entry.sol")
        return 'import "@openzeppelin/ERC20.sol";\nimport "./Local.sol";';
      if (p === "Local.sol") return "contract Local {}";
      throw new Error(`unexpected: ${p}`);
    };
    const { files, externalImports } = await prepareSolidityClosure({
      entryPaths: ["entry.sol"],
      readFile,
    });
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "entry.sol");
    assert.equal(files[1].path, "Local.sol");
    assert.ok(externalImports.includes("@openzeppelin/ERC20.sol"), "should collect external import");
  });

  it("assigns entry role to entry files and dependency role to others", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile: createLocalReadFile(treeRoot),
    });
    const entry = files.find((f) => f.path === "contracts/core/Bank.sol");
    assert.equal(entry.role, "entry");
    const dep = files.find((f) => f.path === "contracts/libraries/Math.sol");
    assert.equal(dep.role, "dependency");
  });

  it("collects named imports (from-style)", async () => {
    const readFile = async (p) => {
      if (p === "entry.sol")
        return 'import { Foo } from "./Foo.sol";';
      if (p === "Foo.sol") return "contract Foo {}";
      throw new Error(`unexpected: ${p}`);
    };
    const { files } = await prepareSolidityClosure({
      entryPaths: ["entry.sol"],
      readFile,
    });
    assert.equal(files.length, 2);
    assert.equal(files[1].path, "Foo.sol");
  });
});
