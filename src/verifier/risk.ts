import type { RiskLevel } from "../core/types.js";

const secretFileNames = new Set([".env", ".env.local", ".env.production", ".npmrc"]);

export function classifyRiskFromDiffSummary(changedFiles: string[]): RiskLevel {
  if (changedFiles.some((file) => secretFileNames.has(file.split(/[\\/]/).at(-1) ?? file) || file.includes("secret") || file.includes("credential"))) {
    return "critical";
  }
  if (changedFiles.length > 50) {
    return "critical";
  }
  if (changedFiles.some((file) => file.includes("migration") || file.includes("schema"))) {
    return "high";
  }
  if (changedFiles.length === 0) {
    return "low";
  }
  return "medium";
}
