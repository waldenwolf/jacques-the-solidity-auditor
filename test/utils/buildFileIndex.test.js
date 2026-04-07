import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLocalFileIndex } from "../../utils/files/buildFileIndex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "..", "fixtures");

describe("buildLocalFileIndex", () => {
  it("indexes all .sol files in the named-imports-protocol fixture", async () => {
    const root = path.join(fixturesDir, "named-imports-protocol");
    const index = await buildLocalFileIndex(root);

    assert.ok(index.has("vault.sol"), "should index Vault.sol");
    assert.ok(index.has("token.sol"), "should index Token.sol");
    assert.ok(index.has("ivault.sol"), "should index IVault.sol");
    assert.ok(index.has("itoken.sol"), "should index IToken.sol");
    assert.ok(index.has("vaultstorage.sol"), "should index VaultStorage.sol");
  });

  it("keys are lowercase basenames", async () => {
    const root = path.join(fixturesDir, "named-imports-protocol");
    const index = await buildLocalFileIndex(root);

    for (const [key] of index) {
      assert.equal(key, key.toLowerCase(), `key ${key} should be lowercase`);
      assert.ok(key.endsWith(".sol"), `key ${key} should end with .sol`);
    }
  });

  it("values contain repo-relative posix paths", async () => {
    const root = path.join(fixturesDir, "named-imports-protocol");
    const index = await buildLocalFileIndex(root);

    const vaultPaths = index.get("vault.sol");
    assert.ok(vaultPaths, "should have vault.sol entry");
    assert.ok(vaultPaths.includes("core/Vault.sol"), `should contain core/Vault.sol, got ${vaultPaths}`);
  });

  it("does not include non-.sol files", async () => {
    const root = path.join(fixturesDir, "named-imports-protocol");
    const index = await buildLocalFileIndex(root);

    for (const [key] of index) {
      assert.ok(key.endsWith(".sol"), `should only contain .sol files, found ${key}`);
    }
  });

  it("works with the lending-protocol fixture", async () => {
    const root = path.join(fixturesDir, "lending-protocol");
    const index = await buildLocalFileIndex(root);

    assert.ok(index.has("lendingpool.sol"), "should index LendingPool.sol");
    assert.ok(index.has("priceoracle.sol"), "should index PriceOracle.sol");
    assert.ok(index.has("wadmath.sol"), "should index WadMath.sol");
    assert.ok(index.has("ierc20.sol"), "should index IERC20.sol");
    assert.ok(index.has("ipriceoracle.sol"), "should index IPriceOracle.sol");
  });
});
