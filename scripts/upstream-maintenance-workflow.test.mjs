import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/upstream-maintenance.yml"), "utf8");

describe("upstream maintenance workflow", () => {
  it("serializes watcher runs, verifies upstream before checking, and provisions issue ownership", () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s+group: upstream-maintenance-watcher\s*\n\s+cancel-in-progress: false/);
    const remoteStep = workflow.indexOf("Add and verify explicit upstream remote");
    const checkerStep = workflow.indexOf("Check explicit upstream refs");
    expect(remoteStep).toBeGreaterThan(-1);
    expect(remoteStep).toBeLessThan(checkerStep);
    expect(workflow).toContain('git remote add upstream "$expected"');
    expect(workflow).toContain('test "$(git remote get-url upstream)" = "$expected"');
    expect(workflow).toContain("Ensure controlled issue label exists");
    expect(workflow).toContain("labels/upstream-maintenance");
    expect(workflow).toContain("name='upstream-maintenance'");
  });
});
