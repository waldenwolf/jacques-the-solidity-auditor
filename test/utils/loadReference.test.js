import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadReference } from "../../utils/loadPrompt.js";

describe("loadReference", () => {
  it("loads staking reference for 'staking' protocol type", () => {
    const ref = loadReference("staking");
    assert.ok(ref.length > 100, "staking reference should be non-trivial");
    assert.ok(ref.includes("Stale Checkpoint"), "should contain the key pattern name");
  });

  it("loads staking reference for 'vault' protocol type via mapping", () => {
    const ref = loadReference("vault");
    assert.ok(ref.includes("Stale Checkpoint"));
  });

  it("returns fallback message for unknown protocol type", () => {
    const ref = loadReference("unknown-proto-xyz");
    assert.equal(ref, "No protocol-specific reference available.");
  });

  it("returns fallback for null/undefined input", () => {
    assert.equal(loadReference(null), "No protocol-specific reference available.");
    assert.equal(loadReference(undefined), "No protocol-specific reference available.");
  });

  it("is case-insensitive", () => {
    const ref = loadReference("STAKING");
    assert.ok(ref.includes("Stale Checkpoint"));
  });
});
