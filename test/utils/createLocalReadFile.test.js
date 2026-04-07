import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalReadFile } from "../../utils/files/createLocalReadFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "..", "fixtures", "solidity-tree");

describe("createLocalReadFile", () => {
  it("reads a file under the repo root", async () => {
    const readFile = createLocalReadFile(fixtureRoot);
    const content = await readFile("contracts/libraries/Math.sol");
    assert.match(content, /library Math/);
  });

  it("rejects path traversal above root", async () => {
    const readFile = createLocalReadFile(fixtureRoot);
    await assert.rejects(
      () => readFile("../../etc/passwd"),
      /Path escapes repo root/,
    );
  });

  it("rejects paths that traverse above root via many ../", async () => {
    const readFile = createLocalReadFile(fixtureRoot);
    await assert.rejects(
      () => readFile("../../../../../../../etc/passwd"),
      /Path escapes repo root/,
    );
  });

  it("throws on non-existent file", async () => {
    const readFile = createLocalReadFile(fixtureRoot);
    await assert.rejects(() => readFile("does-not-exist.sol"));
  });
});
