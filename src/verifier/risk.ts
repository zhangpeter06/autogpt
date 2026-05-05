import type { RiskLevel } from "../core/types.js";

function isSecretFile(file: string): boolean {
  const normalized = file.toLowerCase();
  const basename = normalized.split(/[\\/]/).at(-1) ?? normalized;
  return basename === ".env" || basename.startsWith(".env.") || basename === ".npmrc" || normalized.includes("secret") || normalized.includes("credential");
}

export function classifyRiskFromDiffSummary(changedFiles: string[]): RiskLevel {
  if (changedFiles.some((file) => isSecretFile(file))) {
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
