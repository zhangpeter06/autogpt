import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { appendJsonl, readJsonl } from "../../src/core/jsonl.js";

describe("jsonl store", () => {
  it("appends and reads records in order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gptauto-jsonl-"));
    const file = join(dir, "records.jsonl");
    try {
      await appendJsonl(file, { id: "a", value: 1 });
      await appendJsonl(file, { id: "b", value: 2 });
      await expect(readJsonl<{ id: string; value: number }>(file)).resolves.toEqual([
        { id: "a", value: 1 },
        { id: "b", value: 2 }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty array for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gptauto-jsonl-missing-"));
    try {
      await expect(readJsonl(join(dir, "missing.jsonl"))).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
