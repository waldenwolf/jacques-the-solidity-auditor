import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverImplementations, parseInheritedInterfaces } from "../../utils/files/discoverImplementations.js";
import { buildLocalFileIndex } from "../../utils/files/buildFileIndex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const namedFixtureRoot = path.resolve(__dirname, "..", "fixtures", "named-imports-protocol");

describe("parseInheritedInterfaces", () => {
  it("extracts interfaces from contract inheritance", () => {
    const src = "contract Vault is IVault, IToken {";
    const result = parseInheritedInterfaces(src);
    assert.deepEqual(result, ["IVault", "IToken"]);
  });

  it("extracts interfaces from abstract contract", () => {
    const src = "abstract contract Base is IBase, Ownable {";
    const result = parseInheritedInterfaces(src);
    assert.deepEqual(result, ["IBase"]);
  });

  it("ignores non-I-prefixed parents", () => {
    const src = "contract Foo is Ownable, ReentrancyGuard {";
    const result = parseInheritedInterfaces(src);
    assert.deepEqual(result, []);
  });

  it("returns empty for contract without inheritance", () => {
    const src = "contract Simple {";
    const result = parseInheritedInterfaces(src);
    assert.deepEqual(result, []);
  });

  it("handles constructor args in parent list", () => {
    const src = "contract Vault is IVault, OwnableUpgradeable {";
    const result = parseInheritedInterfaces(src);
    assert.deepEqual(result, ["IVault"]);
  });
});

describe("discoverImplementations", () => {
  it("discovers implementation for I-prefixed interface files", () => {
    const resolvedFiles = [
      { path: "interfaces/IVault.sol", content: "interface IVault { function deposit(uint256) external; }" },
    ];
    const fileIndex = new Map([
      ["ivault.sol", ["interfaces/IVault.sol"]],
      ["vault.sol", ["core/Vault.sol"]],
      ["vaultstorage.sol", ["storage/VaultStorage.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.ok(discovered.includes("core/Vault.sol"), "should discover Vault.sol from IVault.sol");
  });

  it("discovers storage contracts for non-interface files", () => {
    const resolvedFiles = [
      { path: "core/Vault.sol", content: "contract Vault is IVault {}" },
    ];
    const fileIndex = new Map([
      ["vault.sol", ["core/Vault.sol"]],
      ["vaultstorage.sol", ["storage/VaultStorage.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.ok(discovered.includes("storage/VaultStorage.sol"), "should discover VaultStorage.sol");
  });

  it("discovers implementations from contract inheritance", () => {
    const resolvedFiles = [
      { path: "core/Main.sol", content: "contract Main is IToken, IVault {}" },
    ];
    const fileIndex = new Map([
      ["token.sol", ["core/Token.sol"]],
      ["vault.sol", ["core/Vault.sol"]],
      ["main.sol", ["core/Main.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.ok(discovered.includes("core/Token.sol"), "should discover Token.sol from IToken inheritance");
    assert.ok(discovered.includes("core/Vault.sol"), "should discover Vault.sol from IVault inheritance");
  });

  it("handles case-insensitive matching (IveRAACToken -> VeRAACToken)", () => {
    const resolvedFiles = [
      { path: "interfaces/IveRAACToken.sol", content: "interface IveRAACToken {}" },
    ];
    const fileIndex = new Map([
      ["iveraactoken.sol", ["interfaces/IveRAACToken.sol"]],
      ["veraactoken.sol", ["core/VeRAACToken.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.ok(discovered.includes("core/VeRAACToken.sol"), "should discover VeRAACToken.sol via case-insensitive match");
  });

  it("does not discover already-resolved files", () => {
    const resolvedFiles = [
      { path: "interfaces/IVault.sol", content: "interface IVault {}" },
      { path: "core/Vault.sol", content: "contract Vault is IVault {}" },
    ];
    const fileIndex = new Map([
      ["ivault.sol", ["interfaces/IVault.sol"]],
      ["vault.sol", ["core/Vault.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.equal(discovered.length, 0, "should not rediscover already-resolved files");
  });

  it("returns empty when no matches found", () => {
    const resolvedFiles = [
      { path: "core/Standalone.sol", content: "contract Standalone {}" },
    ];
    const fileIndex = new Map([
      ["standalone.sol", ["core/Standalone.sol"]],
    ]);
    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.equal(discovered.length, 0);
  });
});

describe("discoverImplementations with real fixture index", () => {
  it("discovers Token.sol and VaultStorage.sol from named-imports-protocol fixture", async () => {
    const fileIndex = await buildLocalFileIndex(namedFixtureRoot);

    const resolvedFiles = [
      { path: "core/Vault.sol", content: `import {IVault} from "../interfaces/IVault.sol";\nimport {IToken} from "../interfaces/IToken.sol";\ncontract Vault is IVault {}` },
      { path: "interfaces/IVault.sol", content: "interface IVault {}" },
      { path: "interfaces/IToken.sol", content: "interface IToken {}" },
    ];

    const discovered = discoverImplementations(resolvedFiles, fileIndex);
    assert.ok(discovered.includes("core/Token.sol"), "should find Token.sol from IToken.sol");
    assert.ok(discovered.includes("storage/VaultStorage.sol"), "should find VaultStorage.sol");
  });
});
