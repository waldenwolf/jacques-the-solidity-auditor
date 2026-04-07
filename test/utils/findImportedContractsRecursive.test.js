import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findImportedContractsRecursive } from "../../utils/files/findImportedContractsRecursive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const treeRoot = path.join(__dirname, "..", "fixtures", "solidity-tree");

describe("findImportedContractsRecursive", () => {
  it("returns absolute paths for entry and all transitive imports", async () => {
    const entry = path.join(treeRoot, "contracts/core/Bank.sol");
    const set = await findImportedContractsRecursive(entry, treeRoot);
    assert.equal(set.size, 4);
    assert.ok(set.has(path.resolve(treeRoot, "contracts/core/Bank.sol")));
    assert.ok(set.has(path.resolve(treeRoot, "contracts/libraries/Math.sol")));
    assert.ok(set.has(path.resolve(treeRoot, "contracts/core/BankReceiptToken.sol")));
    assert.ok(set.has(path.resolve(treeRoot, "contracts/libraries/ExtendedMath.sol")));
  });

  it("rejects entry outside repo root", async () => {
    await assert.rejects(
      () => findImportedContractsRecursive("/etc/passwd", treeRoot),
      /Entry path is not under repo root/,
    );
  });

  it("defaults repoRoot to cwd", async () => {
    const entry = path.join(treeRoot, "contracts/core/Bank.sol");
    const set = await findImportedContractsRecursive(entry, treeRoot);
    assert.ok(set instanceof Set);
    assert.ok(set.size > 0);
  });
});
