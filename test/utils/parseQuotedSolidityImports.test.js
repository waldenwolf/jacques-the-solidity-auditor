import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuotedSolidityImports } from "../../utils/files/parseQuotedSolidityImports.js";

describe("parseQuotedSolidityImports", () => {
  it("finds double-quoted bare imports", () => {
    assert.deepEqual(
      parseQuotedSolidityImports('import "./Foo.sol";'),
      ["./Foo.sol"],
    );
  });

  it("finds single-quoted bare imports", () => {
    assert.deepEqual(
      parseQuotedSolidityImports("import '../Bar.sol';"),
      ["../Bar.sol"],
    );
  });

  it("finds multiple bare imports", () => {
    const src = `
import "./A.sol";
import "../B.sol";
import "./sub/C.sol";
`;
    assert.deepEqual(parseQuotedSolidityImports(src), [
      "./A.sol",
      "../B.sol",
      "./sub/C.sol",
    ]);
  });

  it("finds named imports (curly brace style)", () => {
    const src = 'import {Foo} from "./Foo.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("finds named imports with spaces", () => {
    const src = 'import { Foo } from "./Foo.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("finds named imports with alias", () => {
    const src = 'import { Foo as Bar } from "./Foo.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("finds wildcard imports", () => {
    const src = 'import * as Foo from "./Foo.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("finds bare aliased imports", () => {
    const src = 'import "./Foo.sol" as Foo;';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("finds multi-line named imports", () => {
    const src = `import {
  OwnableUpgradeable
} from "../access/OwnableUpgradeable.sol";`;
    assert.deepEqual(parseQuotedSolidityImports(src), ["../access/OwnableUpgradeable.sol"]);
  });

  it("finds multi-line named imports with multiple symbols", () => {
    const src = `import {
  Foo,
  Bar,
  Baz
} from "./MultiLib.sol";`;
    assert.deepEqual(parseQuotedSolidityImports(src), ["./MultiLib.sol"]);
  });

  it("handles real-world RAACLiquidLocker-style imports", () => {
    const src = `
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IveRAACToken} from "../../interfaces/core/tokens/IveRAACToken.sol";
import {ILiquidEscrowedRAAC} from "../../interfaces/core/tokens/ILiquidEscrowedRAAC.sol";
import {IGaugeController} from "../../interfaces/core/governance/gauges/IGaugeController.sol";
`;
    const result = parseQuotedSolidityImports(src);
    assert.ok(result.includes("@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol"));
    assert.ok(result.includes("@openzeppelin/contracts/token/ERC20/IERC20.sol"));
    assert.ok(result.includes("../../interfaces/core/tokens/IveRAACToken.sol"));
    assert.ok(result.includes("../../interfaces/core/tokens/ILiquidEscrowedRAAC.sol"));
    assert.equal(result.length, 6);
  });

  it("handles mixed import styles in one file", () => {
    const src = `
import "./A.sol";
import { B } from "./B.sol";
import * as C from "./C.sol";
import "./D.sol" as D;
import {
  E,
  F
} from "./EF.sol";
`;
    const result = parseQuotedSolidityImports(src);
    assert.equal(result.length, 5);
    assert.ok(result.includes("./A.sol"));
    assert.ok(result.includes("./B.sol"));
    assert.ok(result.includes("./C.sol"));
    assert.ok(result.includes("./D.sol"));
    assert.ok(result.includes("./EF.sol"));
  });

  it("deduplicates same path imported multiple ways", () => {
    const src = `
import "./Foo.sol";
import { Bar } from "./Foo.sol";
`;
    assert.deepEqual(parseQuotedSolidityImports(src), ["./Foo.sol"]);
  });

  it("returns empty array when no imports", () => {
    assert.deepEqual(parseQuotedSolidityImports("contract X {}"), []);
  });

  it("handles import with extra whitespace", () => {
    assert.deepEqual(
      parseQuotedSolidityImports('import   "./Spaced.sol"  ;'),
      ["./Spaced.sol"],
    );
  });

  it("is idempotent across multiple calls (regex lastIndex reset)", () => {
    const src = 'import "./A.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./A.sol"]);
    assert.deepEqual(parseQuotedSolidityImports(src), ["./A.sol"]);
  });

  it("is idempotent for named imports across calls", () => {
    const src = 'import { X } from "./X.sol";';
    assert.deepEqual(parseQuotedSolidityImports(src), ["./X.sol"]);
    assert.deepEqual(parseQuotedSolidityImports(src), ["./X.sol"]);
  });

  it("handles ReentrancyGuardUpgradeable multi-line import", () => {
    const src = `import {ReentrancyGuardUpgradeable} from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";`;
    assert.deepEqual(parseQuotedSolidityImports(src), [
      "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol",
    ]);
  });
});
