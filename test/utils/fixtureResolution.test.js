import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createLocalReadFile } from "../../utils/files/createLocalReadFile.js";
import { prepareSolidityClosure } from "../../utils/prepareSolidityClosure.js";
import { formatContextMarkdown } from "../../utils/formatContextMarkdown.js";
import { buildLocalFileIndex } from "../../utils/files/buildFileIndex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "..", "fixtures");

describe("fixture resolution — lending-protocol", () => {
  const root = path.join(fixturesDir, "lending-protocol");
  const readFile = createLocalReadFile(root);

  it("resolves LendingPool.sol with all transitive dependencies", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/LendingPool.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/LendingPool.sol"), "should include entry");
    assert.ok(paths.includes("interfaces/IERC20.sol"), "should include IERC20 interface");
    assert.ok(paths.includes("interfaces/IPriceOracle.sol"), "should include IPriceOracle interface");
    assert.ok(paths.includes("libraries/WadMath.sol"), "should include WadMath library");
    assert.equal(paths.length, 4, "should have exactly 4 files");
  });

  it("resolves PriceOracle.sol with its interface", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/PriceOracle.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/PriceOracle.sol"));
    assert.ok(paths.includes("interfaces/IPriceOracle.sol"));
    assert.equal(paths.length, 2);
  });

  it("resolves both entry files without duplicating shared deps", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/LendingPool.sol", "core/PriceOracle.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    const unique = new Set(paths);
    assert.equal(paths.length, unique.size, "should not have duplicates");
    assert.ok(paths.includes("interfaces/IPriceOracle.sol"));
    assert.equal(paths.length, 5, "LendingPool(4) + PriceOracle entry(1), shared deps deduped");
  });

  it("generates valid context markdown for the full protocol", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/LendingPool.sol", "core/PriceOracle.sol"],
      readFile,
    });

    const md = formatContextMarkdown(files);
    assert.match(md, /LendingPool/, "should contain LendingPool");
    assert.match(md, /PriceOracle/, "should contain PriceOracle");
    assert.match(md, /IPriceOracle/, "should contain IPriceOracle");
    assert.match(md, /WadMath/, "should contain WadMath");
    assert.match(md, /```solidity/, "should have solidity code blocks");
  });
});

describe("fixture resolution — vault-protocol", () => {
  const root = path.join(fixturesDir, "vault-protocol");
  const readFile = createLocalReadFile(root);

  it("resolves YieldVault.sol with full dependency tree", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/YieldVault.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/YieldVault.sol"), "should include entry");
    assert.ok(paths.includes("interfaces/IERC20.sol"), "should include IERC20");
    assert.ok(paths.includes("interfaces/IERC4626.sol"), "should include IERC4626");
    assert.ok(paths.includes("libraries/ShareMath.sol"), "should include ShareMath");
    assert.ok(paths.includes("core/YieldStrategy.sol"), "should include YieldStrategy");
    assert.equal(paths.length, 5, "should have exactly 5 files");
  });

  it("IERC4626 transitively brings in IERC20", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["interfaces/IERC4626.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("interfaces/IERC4626.sol"));
    assert.ok(paths.includes("interfaces/IERC20.sol"), "IERC4626 imports IERC20");
    assert.equal(paths.length, 2);
  });
});

describe("fixture resolution — proxy-protocol", () => {
  const root = path.join(fixturesDir, "proxy-protocol");
  const readFile = createLocalReadFile(root);

  it("resolves TokenBridge.sol with interface and library", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/TokenBridge.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/TokenBridge.sol"), "should include entry");
    assert.ok(paths.includes("interfaces/IBridge.sol"), "should include IBridge");
    assert.ok(paths.includes("libraries/SignatureVerifier.sol"), "should include SignatureVerifier");
    assert.equal(paths.length, 3, "should have exactly 3 files");
  });

  it("resolves both proxy and implementation as entry points", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["proxy/ERC1967Proxy.sol", "core/TokenBridge.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("proxy/ERC1967Proxy.sol"), "should include proxy");
    assert.ok(paths.includes("core/TokenBridge.sol"), "should include implementation");
    assert.ok(paths.includes("interfaces/IBridge.sol"), "should include interface");
    assert.ok(paths.includes("libraries/SignatureVerifier.sol"), "should include library");
    assert.equal(paths.length, 4);
  });
});

describe("fixture resolution — named-imports-protocol (named imports + implementation discovery)", () => {
  const root = path.join(fixturesDir, "named-imports-protocol");
  const readFile = createLocalReadFile(root);

  it("resolves named imports (import { X } from) in Vault.sol", async () => {
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/Vault.sol"],
      readFile,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/Vault.sol"), "should include entry");
    assert.ok(paths.includes("interfaces/IVault.sol"), "should resolve named import IVault");
    assert.ok(paths.includes("interfaces/IToken.sol"), "should resolve named import IToken");
    assert.equal(paths.length, 3, "should have entry + 2 interfaces");
  });

  it("discovers implementation files when file index is provided", async () => {
    const fileIndex = await buildLocalFileIndex(root);
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/Vault.sol"],
      readFile,
      fileIndex,
    });

    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("core/Vault.sol"), "should include entry");
    assert.ok(paths.includes("interfaces/IVault.sol"), "should include interface");
    assert.ok(paths.includes("interfaces/IToken.sol"), "should include interface");
    assert.ok(paths.includes("core/Token.sol"), "should discover Token.sol from IToken.sol");
    assert.ok(paths.includes("storage/VaultStorage.sol"), "should discover VaultStorage.sol");
  });

  it("assigns correct roles to discovered files", async () => {
    const fileIndex = await buildLocalFileIndex(root);
    const { files } = await prepareSolidityClosure({
      entryPaths: ["core/Vault.sol"],
      readFile,
      fileIndex,
    });

    const vault = files.find((f) => f.path === "core/Vault.sol");
    assert.equal(vault.role, "entry");

    const iVault = files.find((f) => f.path === "interfaces/IVault.sol");
    assert.equal(iVault.role, "interface");

    const token = files.find((f) => f.path === "core/Token.sol");
    assert.equal(token.role, "implementation");
  });

  it("collects external imports separately", async () => {
    const mockReadFile = async (p) => {
      if (p === "core/Entry.sol")
        return 'import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";\nimport {IVault} from "../interfaces/IVault.sol";';
      return readFile(p);
    };
    const { externalImports } = await prepareSolidityClosure({
      entryPaths: ["core/Entry.sol"],
      readFile: mockReadFile,
    });

    assert.ok(
      externalImports.includes("@openzeppelin/contracts/token/ERC20/IERC20.sol"),
      "should collect @openzeppelin import as external",
    );
  });

  it("generates context markdown with role tags", async () => {
    const fileIndex = await buildLocalFileIndex(root);
    const { files, externalImports } = await prepareSolidityClosure({
      entryPaths: ["core/Vault.sol"],
      readFile,
      fileIndex,
    });

    const md = formatContextMarkdown(files, { externalImports });
    assert.match(md, /Entry file/, "should tag entry file");
    assert.match(md, /Interface/, "should tag interface files");
    assert.match(md, /Implementation \(discovered\)/, "should tag discovered implementations");
  });
});
