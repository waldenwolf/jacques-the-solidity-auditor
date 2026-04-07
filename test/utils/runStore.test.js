import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";

import { createRunStore, openRunStore } from "../../utils/runStore.js";

describe("createRunStore", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runstore-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a timestamped run directory", () => {
    const store = createRunStore(tmpDir);
    assert.ok(fs.existsSync(store.runDir));
    assert.ok(store.runDir.includes("tmp/runs/"));
  });

  it("save and load round-trip for JSON data", () => {
    const store = createRunStore(tmpDir);
    const data = { model: "opus", count: 42 };
    store.save("00-config", data);

    assert.ok(store.has("00-config"));
    const loaded = store.load("00-config");
    assert.deepStrictEqual(loaded, data);
  });

  it("save and load round-trip for string (markdown) data", () => {
    const store = createRunStore(tmpDir);
    const md = "# Report\n\nSome findings here.";
    store.save("01-context", md);

    assert.ok(store.has("01-context"));
    assert.equal(store.load("01-context"), md);
  });

  it("has returns false for missing steps", () => {
    const store = createRunStore(tmpDir);
    assert.equal(store.has("99-nonexistent"), false);
  });

  it("load throws for missing steps", () => {
    const store = createRunStore(tmpDir);
    assert.throws(() => store.load("99-nonexistent"), /not found/);
  });

  it("list returns matching step names sorted", () => {
    const store = createRunStore(tmpDir);
    store.save("03-agent-02-access-control", "findings B");
    store.save("03-agent-01-reentrancy", "findings A");
    store.save("03-agents-all", "all findings");
    store.save("02-classify", { type: "vault" });

    const agents = store.list("03-agent-");
    assert.deepStrictEqual(agents, [
      "03-agent-01-reentrancy",
      "03-agent-02-access-control",
    ]);

    const allThrees = store.list("03-");
    assert.ok(allThrees.includes("03-agents-all"));
  });
});

describe("openRunStore", () => {
  let tmpDir;
  let existingRunDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runstore-test-"));
    const original = createRunStore(tmpDir);
    existingRunDir = original.runDir;
    original.save("00-config", { model: "opus" });
    original.save("01-context", "# Context\ncode here");
    original.save("03-agent-01-reentrancy", "reentrancy findings");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens an existing run directory", () => {
    const store = openRunStore(existingRunDir);
    assert.equal(store.runDir, existingRunDir);
  });

  it("throws if directory does not exist", () => {
    assert.throws(() => openRunStore("/nonexistent/path"), /does not exist/);
  });

  it("can load data saved by a previous store", () => {
    const store = openRunStore(existingRunDir);
    assert.ok(store.has("00-config"));
    assert.deepStrictEqual(store.load("00-config"), { model: "opus" });
    assert.equal(store.load("01-context"), "# Context\ncode here");
    assert.equal(store.load("03-agent-01-reentrancy"), "reentrancy findings");
  });

  it("can save new data to the existing directory", () => {
    const store = openRunStore(existingRunDir);
    store.save("03-agent-02-access-control", "access findings");
    assert.ok(store.has("03-agent-02-access-control"));
    assert.equal(store.load("03-agent-02-access-control"), "access findings");
  });

  it("list returns steps from previous and new saves", () => {
    const store = openRunStore(existingRunDir);
    store.save("03-agent-02-access-control", "access findings");
    const agents = store.list("03-agent-");
    assert.ok(agents.includes("03-agent-01-reentrancy"));
    assert.ok(agents.includes("03-agent-02-access-control"));
  });
});
