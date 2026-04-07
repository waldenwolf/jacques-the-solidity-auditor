import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatContextMarkdown } from "../../utils/formatContextMarkdown.js";

describe("formatContextMarkdown", () => {
  it("emits simple code blocks without options", () => {
    const md = formatContextMarkdown([
      { path: "a.sol", content: "contract A {}" },
    ]);
    assert.match(md, /### File: a\.sol/);
    assert.match(md, /\*\*Code:\*\*/);
    assert.match(md, /```solidity\ncontract A {}/);
    assert.match(md, /---/);
  });

  it("handles multiple files", () => {
    const md = formatContextMarkdown([
      { path: "a.sol", content: "contract A {}" },
      { path: "b.sol", content: "contract B {}" },
    ]);
    assert.match(md, /### File: a\.sol/);
    assert.match(md, /### File: b\.sol/);
  });

  it("emits PR metadata with perFile and changedPathsInOrder", () => {
    const md = formatContextMarkdown(
      [
        { path: "changed.sol", content: "contract C {}" },
        { path: "dep.sol", content: "library D {}" },
      ],
      {
        perFile: {
          "changed.sol": { status: "modified", patch: "@@ -1 +1 @@" },
        },
        changedPathsInOrder: ["changed.sol"],
      },
    );
    assert.match(md, /\*\*Status:\*\* modified/);
    assert.match(md, /\*\*Prior version:\*\*/);
    assert.match(md, /```diff/);
    assert.match(md, /### File: dep\.sol/);
    assert.match(md, /\*\*Code:\*\*/);
  });

  it("emits Code section for added files", () => {
    const md = formatContextMarkdown(
      [{ path: "new.sol", content: "contract N {}" }],
      {
        perFile: { "new.sol": { status: "added", patch: "+contract N {}" } },
        changedPathsInOrder: ["new.sol"],
      },
    );
    assert.match(md, /\*\*Status:\*\* added/);
    assert.match(md, /\*\*Code:\*\*/);
  });

  it("places changed files before dependency files", () => {
    const md = formatContextMarkdown(
      [
        { path: "dep.sol", content: "library Dep {}" },
        { path: "main.sol", content: "contract Main {}" },
      ],
      {
        perFile: { "main.sol": { status: "modified", patch: "diff" } },
        changedPathsInOrder: ["main.sol"],
      },
    );
    const mainIdx = md.indexOf("### File: main.sol");
    const depIdx = md.indexOf("### File: dep.sol");
    assert.ok(mainIdx < depIdx, "changed file should appear before dependency");
  });

  it("returns empty string for empty input", () => {
    assert.equal(formatContextMarkdown([]), "");
  });

  it("emits role tags when files have roles", () => {
    const md = formatContextMarkdown([
      { path: "core/Main.sol", content: "contract Main {}", role: "entry" },
      { path: "interfaces/IMain.sol", content: "interface IMain {}", role: "interface" },
      { path: "core/Impl.sol", content: "contract Impl {}", role: "implementation" },
      { path: "lib/Utils.sol", content: "library Utils {}", role: "dependency" },
    ]);
    assert.match(md, /Entry file \(audit target\)/);
    assert.match(md, /\*\*Role:\*\* Interface/);
    assert.match(md, /Implementation \(discovered\)/);
    assert.match(md, /Dependency \(imported\)/);
  });

  it("emits external dependency section", () => {
    const md = formatContextMarkdown(
      [{ path: "a.sol", content: "contract A {}" }],
      {
        externalImports: [
          "@openzeppelin/contracts/token/ERC20/IERC20.sol",
          "@openzeppelin/contracts/utils/ReentrancyGuard.sol",
        ],
      },
    );
    assert.match(md, /External Dependencies/);
    assert.match(md, /@openzeppelin\/contracts\/token\/ERC20\/IERC20\.sol/);
    assert.match(md, /@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol/);
  });

  it("omits external dependency section when none", () => {
    const md = formatContextMarkdown([
      { path: "a.sol", content: "contract A {}" },
    ]);
    assert.ok(!md.includes("External Dependencies"));
  });
});
