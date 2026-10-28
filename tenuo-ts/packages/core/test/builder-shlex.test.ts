import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { approvalRequirement } from "../src/index.ts";

const require = createRequire(import.meta.url);
const wasm = require("../src/generated/tenuo_wasm.js") as {
  create_warrant_from_config: (config: unknown) => { warrant_b64: string; error?: string };
};

const mint = (constraint: unknown, approval_gates?: unknown) =>
  wasm.create_warrant_from_config({
    tools: { exec: { command: constraint } }, ttl: 60,
    ...(approval_gates === undefined ? {} : { approval_gates }),
  });

describe("legacy WASM Shlex builder fails closed", () => {
  it("rejects malformed allow lists and unsupported options in both forms", () => {
    for (const options of [
      { allow: [] }, { allow: "cat" }, { allow: ["cat", 42] },
      { allow: [""] }, { allow: ["cat"], allowed: ["grep"] },
      { allow: ["cat"], within: "/work" }, { allow: ["cat"], withn: "/work" },
    ]) {
      for (const constraint of [{ shlex: options }, { type: "Shlex", ...options }]) {
        const result = mint(constraint);
        expect(result.error).toBeTruthy();
        expect(result.warrant_b64).toBe("");
      }
    }
    expect(mint({ pattern: "*", shlex: { allow: [42] } }).error).toBeTruthy();
    expect(mint({ type: "Shlex", pattern: "*", allow: ["cat"] }).error).toBeTruthy();
  });

  it("never silently drops a malformed approval gate or nested constraint", () => {
    for (const gates of [
      { exec: false },
      { exec: { args: [] } },
      { safe: { args: null }, exec: { argz: null } },
      { exec: { args: { command: { exempt: { all: [
        { pattern: "*" }, { shlex: { allow: ["cat", 42] } },
      ] } } } } },
      { exec: { args: { command: { exempt: { min: 0, shlex: { allow: [42] } } } } } },
    ]) {
      const result = mint({ shlex: { allow: ["cat"] } }, gates);
      expect(result.error).toBeTruthy();
      expect(result.warrant_b64).toBe("");
    }
  });

  it("preserves valid Shlex approval exemptions for canonical and alias forms", () => {
    for (const constraint of [{ shlex: { allow: ["cat"] } }, { type: "Shlex", allowed: ["cat"] }]) {
      const result = mint(constraint, {
        exec: { args: { command: { exempt: { shlex: { allow: ["cat"] } } } } },
      });
      expect(result.error).toBeFalsy();
      expect(approvalRequirement(result.warrant_b64, "exec", { command: "cat a.txt" }).status).toBe("exempt");
    }
  });
});
