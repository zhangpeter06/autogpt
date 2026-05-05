import { describe, expect, it } from "vitest";
import { classifyRiskFromDiffSummary } from "../../src/verifier/risk.js";

describe("classifyRiskFromDiffSummary", () => {
  it("flags secret edits as critical", () => {
    expect(classifyRiskFromDiffSummary([".env", "src/app.ts"])).toBe("critical");
  });

  it("flags nested secret file edits as critical", () => {
    expect(classifyRiskFromDiffSummary(["apps/api/.env"])).toBe("critical");
    expect(classifyRiskFromDiffSummary(["services/web/.env.local"])).toBe("critical");
    expect(classifyRiskFromDiffSummary(["packages/foo/.npmrc"])).toBe("critical");
  });

  it("flags env variants and case-insensitive secret paths as critical", () => {
    expect(classifyRiskFromDiffSummary(["apps/api/.env.staging"])).toBe("critical");
    expect(classifyRiskFromDiffSummary([".env.development"])).toBe("critical");
    expect(classifyRiskFromDiffSummary(["src/Secrets.ts"])).toBe("critical");
    expect(classifyRiskFromDiffSummary(["config/CREDENTIALS.json"])).toBe("critical");
  });

  it("flags large deletion sets as critical", () => {
    const files = Array.from({ length: 51 }, (_, index) => `src/file-${index}.ts`);
    expect(classifyRiskFromDiffSummary(files)).toBe("critical");
  });

  it("classifies normal source edits as medium", () => {
    expect(classifyRiskFromDiffSummary(["src/app.ts", "tests/app.test.ts"])).toBe("medium");
  });

  it("classifies migration and schema files as high", () => {
    expect(classifyRiskFromDiffSummary(["db/migrations/001_init.sql"])).toBe("high");
    expect(classifyRiskFromDiffSummary(["src/schema/user.ts"])).toBe("high");
  });

  it("classifies an empty changed file list as low", () => {
    expect(classifyRiskFromDiffSummary([])).toBe("low");
  });
});
