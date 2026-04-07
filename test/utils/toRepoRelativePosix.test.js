import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRepoRelativePosix } from "../../utils/files/toRepoRelativePosix.js";

describe("toRepoRelativePosix", () => {
  it("converts backslashes to forward slashes", () => {
    assert.equal(toRepoRelativePosix("a\\b\\c.sol"), "a/b/c.sol");
  });

  it("normalizes mixed separators", () => {
    assert.equal(toRepoRelativePosix("a\\b/c\\d.sol"), "a/b/c/d.sol");
  });

  it("normalizes redundant slashes", () => {
    assert.equal(toRepoRelativePosix("a//b/c.sol"), "a/b/c.sol");
  });

  it("resolves parent references", () => {
    assert.equal(toRepoRelativePosix("a/b/../c.sol"), "a/c.sol");
  });

  it("strips leading ./", () => {
    assert.equal(toRepoRelativePosix("./a/b.sol"), "a/b.sol");
  });

  it("handles already-posix paths unchanged", () => {
    assert.equal(toRepoRelativePosix("contracts/core/Bank.sol"), "contracts/core/Bank.sol");
  });

  it("coerces non-string to string", () => {
    assert.equal(toRepoRelativePosix(123), "123");
  });
});
