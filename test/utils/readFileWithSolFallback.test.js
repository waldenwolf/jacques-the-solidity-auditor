import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileWithSolFallback } from "../../utils/files/readFileWithSolFallback.js";

describe("readFileWithSolFallback", () => {
  it("passes through when readFile succeeds", async () => {
    const readFile = async (p) => `content of ${p}`;
    const result = await readFileWithSolFallback(readFile, "foo.sol");
    assert.equal(result, "content of foo.sol");
  });

  it("appends .sol when path has no .sol and first read fails", async () => {
    const readFile = async (p) => {
      if (p === "foo") throw new Error("not found");
      return `content of ${p}`;
    };
    const result = await readFileWithSolFallback(readFile, "foo");
    assert.equal(result, "content of foo.sol");
  });

  it("propagates error when path already ends in .sol", async () => {
    const readFile = async () => {
      throw new Error("not found");
    };
    await assert.rejects(
      () => readFileWithSolFallback(readFile, "missing.sol"),
      { message: "not found" },
    );
  });

  it("propagates error when both attempts fail", async () => {
    const readFile = async () => {
      throw new Error("not found");
    };
    await assert.rejects(
      () => readFileWithSolFallback(readFile, "missing"),
      { message: "not found" },
    );
  });
});
