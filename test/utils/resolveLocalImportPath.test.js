import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLocalImportPath } from "../../utils/files/resolveLocalImportPath.js";

describe("resolveLocalImportPath", () => {
  it("resolves parent directory reference", () => {
    assert.equal(
      resolveLocalImportPath("contracts/core/Bank.sol", "../libraries/Math.sol"),
      "contracts/libraries/Math.sol",
    );
  });

  it("resolves same-directory reference", () => {
    assert.equal(
      resolveLocalImportPath("contracts/core/Bank.sol", "./BankReceiptToken.sol"),
      "contracts/core/BankReceiptToken.sol",
    );
  });

  it("resolves deeply nested imports", () => {
    assert.equal(
      resolveLocalImportPath("a/b/c/d.sol", "../../e/f.sol"),
      "a/e/f.sol",
    );
  });

  it("handles file at root level", () => {
    assert.equal(
      resolveLocalImportPath("Root.sol", "./Sibling.sol"),
      "Sibling.sol",
    );
  });
});
