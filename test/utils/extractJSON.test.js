import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractJSON } from "../../scripts/auditor/perform/validate.js";

describe("extractJSON", () => {
  it("parses a clean ```json fence", () => {
    const text = '```json\n{"validated":[],"leads":[]}\n```';
    const result = extractJSON(text);
    assert.deepStrictEqual(result, { validated: [], leads: [] });
  });

  it("parses ```json fence with surrounding prose", () => {
    const text = 'Here is the result:\n\n```json\n{"ok":true}\n```\n\nDone.';
    assert.deepStrictEqual(extractJSON(text), { ok: true });
  });

  it("picks ```json fence over earlier ```solidity fences", () => {
    const text = [
      "Analysis:\n",
      "```solidity",
      "function foo() { bar(); }",
      "```",
      "",
      "```solidity",
      "contract X { uint256 x; }",
      "```",
      "",
      "```json",
      '{"validated":[{"id":"C-1"}],"leads":[],"rejected":[]}',
      "```",
    ].join("\n");
    const result = extractJSON(text);
    assert.equal(result.validated[0].id, "C-1");
    assert.deepStrictEqual(result.leads, []);
  });

  it("falls back to brace matching when no json fence exists", () => {
    const text = 'Some commentary.\n\n{"status":"ok","count":3}\n\nMore text.';
    assert.deepStrictEqual(extractJSON(text), { status: "ok", count: 3 });
  });

  it("strips code fences before brace matching to avoid matching { in code blocks", () => {
    const text = [
      "```solidity",
      "function foo() { if (x > 0) { revert(); } }",
      "```",
      "",
      '{"validated":[],"summary":{"confirmed":0}}',
    ].join("\n");
    const result = extractJSON(text);
    assert.deepStrictEqual(result.validated, []);
    assert.equal(result.summary.confirmed, 0);
  });

  it("handles braces inside JSON string values via string-aware matching", () => {
    const text = '{"proof":"function foo() { bar(); }","ok":true}';
    const result = extractJSON(text);
    assert.equal(result.proof, "function foo() { bar(); }");
    assert.equal(result.ok, true);
  });

  it("handles escaped quotes inside JSON strings", () => {
    const text = '{"desc":"He said \\"hello\\"","n":1}';
    const result = extractJSON(text);
    assert.equal(result.desc, 'He said "hello"');
    assert.equal(result.n, 1);
  });

  it("repairs truncated JSON by closing open brackets and braces", () => {
    const text = '{"validated":[{"id":"C-1"}';
    const result = extractJSON(text);
    assert.equal(result.validated[0].id, "C-1");
  });

  it("throws when no JSON object is present at all", () => {
    assert.throws(() => extractJSON("Just plain text, no JSON."), /No JSON object found/);
  });
});
