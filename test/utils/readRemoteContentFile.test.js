import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRemoteContentFile } from "../../utils/files/readRemoteContentFile.js";

function createMockOctokit(response) {
  return {
    rest: {
      repos: {
        getContent: async () => ({ data: response }),
      },
    },
  };
}

describe("readRemoteContentFile", () => {
  it("decodes base64 file content", async () => {
    const content = Buffer.from("pragma solidity ^0.8.20;").toString("base64");
    const octokit = createMockOctokit({ type: "file", content });
    const result = await readRemoteContentFile(octokit, "owner", "repo", "f.sol", "abc123");
    assert.equal(result, "pragma solidity ^0.8.20;");
  });

  it("rejects directory responses (array)", async () => {
    const octokit = createMockOctokit([{ name: "a.sol" }]);
    await assert.rejects(
      () => readRemoteContentFile(octokit, "owner", "repo", "dir/", "abc123"),
      /Path is a directory/,
    );
  });

  it("rejects non-file type responses", async () => {
    const octokit = createMockOctokit({ type: "symlink", target: "other.sol" });
    await assert.rejects(
      () => readRemoteContentFile(octokit, "owner", "repo", "link.sol", "abc123"),
      /Expected a file with base64 content/,
    );
  });

  it("wraps API errors with context", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: async () => { throw new Error("404 Not Found"); },
        },
      },
    };
    await assert.rejects(
      () => readRemoteContentFile(octokit, "owner", "repo", "missing.sol", "abc123"),
      /Unable to fetch remote content file missing\.sol/,
    );
  });
});
