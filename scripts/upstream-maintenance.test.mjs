import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXIT_UPDATE_AVAILABLE,
  MaintenanceError,
  classifyPath,
  compareCodeUnits,
  comparePackageMetadata,
  executeMaintenance,
  readCurrentMaintenanceReport,
  renderMarkdown,
  sanitizeText,
  validatePackageMetadata,
  validatePolicy,
  writeReport,
} from "./upstream-maintenance-lib.mjs";

function git(cwd, ...args) {
  const env = { ...process.env };
  // Git invokes hooks with repository-local variables that would otherwise redirect
  // fixture commands back into the source repository during pre-commit validation.
  for (const name of ["GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_PREFIX", "GIT_WORK_TREE"]) {
    delete env[name];
  }
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

function write(cwd, relative, content) {
  const path = join(cwd, relative);
  const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  if (directory) mkdirSync(directory, { recursive: true });
  writeFileSync(path, content, "utf8");
}

function commit(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", message);
}

function policyFor(base, origin, upstream) {
  return {
    schemaVersion: 1,
    baseline: { sha: base, releasedVersion: "v1.test.1" },
    remotes: {
      origin: { url: origin, ref: "refs/heads/main" },
      upstream: { url: upstream, ref: "refs/heads/main" },
    },
    classifiers: [
      { id: "api-shared", description: "API", pathGlobs: ["src/api/**"] },
      { id: "sessiond-runtime", description: "Runtime", pathGlobs: ["runtime/**"] },
      { id: "dependencies-engines-releases", description: "Package", pathGlobs: ["package.json"] },
    ],
    intentionalDivergence: [
      { id: "custom", description: "Fork", pathGlobs: ["custom/**"] },
      { id: "metadata", description: "Metadata", pathGlobs: ["package.json"] },
    ],
  };
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi web maintenance fixture "));
  const seed = join(root, "seed");
  git(root, "init", "--initial-branch=main", "-q", seed);
  git(seed, "config", "user.email", "test@example.test");
  git(seed, "config", "user.name", "Test");
  write(seed, "package.json", JSON.stringify({ name: "fixture", dependencies: { alpha: "1" }, engines: { node: ">=22" } }, null, 2));
  write(seed, "shared.txt", "base\n");
  commit(seed, "base");
  const baseline = git(seed, "rev-parse", "HEAD");
  const originBare = join(root, "origin.git");
  const upstreamBare = join(root, "upstream.git");
  git(root, "clone", "--bare", "-q", seed, originBare);
  git(root, "clone", "--bare", "-q", seed, upstreamBare);

  const upstreamWork = join(root, "upstream work");
  git(root, "clone", "-q", upstreamBare, upstreamWork);
  git(upstreamWork, "config", "user.email", "test@example.test");
  git(upstreamWork, "config", "user.name", "Test");
  write(upstreamWork, "src/api/upstream.ts", "export const upstream = true;\n");
  write(upstreamWork, "shared.txt", "upstream\n");
  write(upstreamWork, "package.json", JSON.stringify({ name: "fixture", dependencies: { alpha: "2", beta: "1" }, peerDependencies: { peer: "1" }, engines: { node: ">=24" } }, null, 2));
  commit(upstreamWork, "upstream <script>@team");
  git(upstreamWork, "tag", "v1.2.0");
  git(upstreamWork, "push", "-q", "origin", "main", "--tags");

  const fork = join(root, "fork work");
  git(root, "clone", "-q", originBare, fork);
  git(fork, "config", "user.email", "test@example.test");
  git(fork, "config", "user.name", "Test");
  git(fork, "remote", "add", "upstream", upstreamBare);
  write(fork, "custom/path with spaces.txt", "fork\n");
  write(fork, "shared.txt", "fork\n");
  commit(fork, "fork");
  git(fork, "push", "-q", "origin", "main");

  const policyPath = join(root, "policy.json");
  writeFileSync(policyPath, JSON.stringify(policyFor(baseline, originBare, upstreamBare), null, 2));
  return { root, fork, policyPath, originBare, upstreamBare, baseline };
}

function sourceFingerprint(repo) {
  return {
    head: git(repo, "rev-parse", "HEAD"),
    index: git(repo, "write-tree"),
    status: git(repo, "status", "--porcelain=v1"),
    refs: git(repo, "for-each-ref", "--format=%(refname):%(objectname)"),
    objects: git(repo, "count-objects", "-v"),
  };
}

describe("upstream maintenance", () => {
  it("strictly validates the policy and classifies Windows-safe paths", () => {
    expect(() => validatePolicy({ schemaVersion: 1 })).toThrow(MaintenanceError);
    expect(classifyPath("custom\\path with spaces.txt", [{ id: "custom", pathGlobs: ["custom/**"] }])).toEqual(["custom"]);
    expect(classifyPath("custom/deep/path.txt", [{ id: "custom", pathGlobs: ["custom/**"] }])).toEqual(["custom"]);
  });

  it("uses fixed UTF-16 code-unit ordering for non-ASCII report data", () => {
    expect(["ä", "z", "a"].sort(compareCodeUnits)).toEqual(["a", "z", "ä"]);
    expect(comparePackageMetadata({ dependencies: { ä: "1", z: "1" } }, { dependencies: { ä: "2", z: "2" } }).dependencies.map((change) => change.name)).toEqual(["z", "ä"]);
  });

  it("normalizes untrusted controls and bidi text and escapes every Markdown boundary", () => {
    const untrusted = "line\r\n\t`*_[x](y) #+-.!|~ <tag>@team\u202E";
    const safe = sanitizeText(untrusted);
    expect(safe).toContain("\\u000D\\u000A\\u0009");
    expect(safe).toContain("\\u202E");
    expect(safe).toContain("&lt;tag&gt;");
    expect(safe).toContain("@\u200bteam");
    const markdown = renderMarkdown({
      baseline: { sha: untrusted, releasedVersion: untrusted }, refs: { origin: untrusted, upstream: untrusted }, status: untrusted,
      ancestry: { leftCount: 0, rightCount: 0 }, mergeSimulation: { clean: true }, pathOverlap: [], unclassifiedForkPaths: [],
      upstream: { commits: [{ sha: untrusted, subject: untrusted }], tags: [{ name: untrusted, sha: untrusted }] },
      signals: { [untrusted]: [untrusted] }, packageDiff: { dependencies: [{ name: untrusted, origin: untrusted, upstream: untrusted }] },
    });
    expect(markdown).not.toMatch(/[\r\n]\t/);
    expect(markdown).not.toContain("<tag>");
    expect(markdown).not.toContain("@team");
    expect(markdown).toContain("\\\\u000D");
    expect(markdown).toContain("\\`");
  });

  it("rejects malformed package metadata before comparison", () => {
    for (const malformed of [
      [],
      { dependencies: [] },
      { devDependencies: { package: 1 } },
      { peerDependencies: { package: null } },
      { optionalDependencies: "invalid" },
      { engines: { node: 22 } },
      { packageManager: {} },
    ]) {
      expect(() => validatePackageMetadata(malformed)).toThrow(MaintenanceError);
    }
    expect(validatePackageMetadata({ dependencies: { package: "1" }, optionalDependencies: { optional: "2" }, engines: { node: ">=22" }, packageManager: "npm@11" })).toBeDefined();
  });

  it("compares dependencies, peers, and engines deterministically", () => {
    expect(comparePackageMetadata(
      { dependencies: { a: "1" }, engines: { node: ">=22" } },
      { dependencies: { a: "2", b: "1" }, peerDependencies: { p: "1" }, engines: { node: ">=24" } },
    )).toMatchObject({
      dependencies: [{ name: "a", origin: "1", upstream: "2" }, { name: "b", origin: null, upstream: "1" }],
      peerDependencies: [{ name: "p", origin: null, upstream: "1" }],
      engines: [{ name: "node", origin: "&gt;=22", upstream: "&gt;=24" }],
    });
  });

  it("uses disposable explicit fetches and atomically publishes a byte-identical current generation", () => {
    const fixture = createFixture();
    try {
      const before = sourceFingerprint(fixture.fork);
      const options = { repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports with spaces" };
      const first = executeMaintenance(options);
      const firstCurrent = readCurrentMaintenanceReport(first.outputs.directory);
      const firstJson = readFileSync(firstCurrent.jsonPath);
      const firstMarkdown = readFileSync(firstCurrent.markdownPath);
      const second = executeMaintenance(options);
      const secondCurrent = readCurrentMaintenanceReport(second.outputs.directory);
      expect(first.exitCode).toBe(EXIT_UPDATE_AVAILABLE);
      expect(second.exitCode).toBe(EXIT_UPDATE_AVAILABLE);
      expect(secondCurrent.generation).toBe(firstCurrent.generation);
      expect(readFileSync(secondCurrent.jsonPath)).toEqual(firstJson);
      expect(readFileSync(secondCurrent.markdownPath)).toEqual(firstMarkdown);
      expect(sourceFingerprint(fixture.fork)).toEqual(before);
      expect(first.report.ancestry).toMatchObject({ leftCount: 1, rightCount: 1 });
      expect(first.report.mergeSimulation.conflict).toBe(true);
      expect(first.report.pathOverlap).toMatchObject([{ matchedPaths: ["shared.txt"], signal: "same-path", fork: { path: "shared.txt" }, upstream: { path: "shared.txt" } }]);
      expect(first.report.changes.fork.find((change) => change.path === "custom/path with spaces.txt")?.divergence).toEqual(["custom"]);
      expect(first.report.unclassifiedForkPaths).toEqual(["shared.txt"]);
      expect(first.report.signals["api-shared"]).toEqual(["src/api/upstream.ts"]);
      expect(first.report.packageDiff.dependencies).toHaveLength(2);
      expect(first.report.upstream.commits[0].subject).toContain("&lt;script&gt;");
      expect(first.report.upstream.tags).toEqual([{ name: "v1.2.0", sha: expect.any(String) }]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("replaces a legacy pointer only after strict readers reject it", () => {
    const fixture = createFixture();
    try {
      const options = { repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" };
      const initial = executeMaintenance(options);
      const current = readCurrentMaintenanceReport(initial.outputs.directory);
      writeFileSync(current.manifestPath, `${JSON.stringify({ schemaVersion: 1, generation: current.generation }, null, 2)}\n`, "utf8");

      expect(() => readCurrentMaintenanceReport(initial.outputs.directory)).toThrow(MaintenanceError);

      const replacement = executeMaintenance(options);
      const replacedCurrent = readCurrentMaintenanceReport(replacement.outputs.directory);
      expect(replacement.exitCode).toBe(EXIT_UPDATE_AVAILABLE);
      expect(replacedCurrent.generation).toBe(current.generation);
      expect(JSON.parse(readFileSync(replacedCurrent.manifestPath, "utf8"))).toEqual({
        schemaVersion: 2,
        generation: current.generation,
        jsonSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        markdownSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("recovers a stale writer lock left by a dead checker", () => {
    const fixture = createFixture();
    try {
      const directory = join(fixture.root, "reports");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "writer.lock"), `${JSON.stringify({
        schemaVersion: 1,
        pid: 2_147_483_647,
        createdAt: Date.now() - 120_000,
        token: "stale-checker",
      })}\n`, "utf8");

      const result = executeMaintenance({ repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" });
      expect(result.exitCode).toBe(EXIT_UPDATE_AVAILABLE);
      expect(readCurrentMaintenanceReport(result.outputs.directory).generation).toBe(result.outputs.generation);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("never advances the pointer on injected staging or pointer failures", () => {
    const fixture = createFixture();
    try {
      const options = { repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" };
      const valid = executeMaintenance(options);
      const prior = readCurrentMaintenanceReport(valid.outputs.directory);
      const upstream = join(fixture.root, "failure upstream");
      git(fixture.root, "clone", "-q", fixture.upstreamBare, upstream);
      git(upstream, "config", "user.email", "test@example.test");
      git(upstream, "config", "user.name", "Test");
      write(upstream, "src/api/newer.ts", "export const newer = true;\n");
      commit(upstream, "new generation");
      git(upstream, "push", "-q", "origin", "main");
      for (const failureInjection of ["before-pointer", "at-pointer"]) {
        expect(() => executeMaintenance({ ...options, failureInjection })).toThrow(MaintenanceError);
        expect(readCurrentMaintenanceReport(valid.outputs.directory).generation).toBe(prior.generation);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects tampered generation content and prevents an older concurrent writer from repointing", () => {
    const fixture = createFixture();
    try {
      const options = { repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" };
      const initial = executeMaintenance(options);
      const current = readCurrentMaintenanceReport(initial.outputs.directory);
      const originalMarkdown = readFileSync(current.markdownPath, "utf8");
      writeFileSync(current.markdownPath, "tampered\n", "utf8");
      expect(() => readCurrentMaintenanceReport(initial.outputs.directory)).toThrow(MaintenanceError);
      writeFileSync(current.markdownPath, originalMarkdown, "utf8");
      // Restore a valid pointer/generation, then make the older writer take its snapshot before
      // the newer publication. Its CAS must reject the stale snapshot after acquiring the lock.
      const restored = executeMaintenance(options);
      const older = { ...restored.report, status: "older" };
      const newer = { ...restored.report, status: "newer" };
      expect(() => writeReport(fixture.fork, older, "../reports", {
        beforeLock: () => writeReport(fixture.fork, newer, "../reports"),
      })).toThrow(/pointer changed/);
      expect(readCurrentMaintenanceReport(restored.outputs.directory).report.status).toBe("newer");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not replace a valid report when policy or package metadata validation fails", () => {
    const fixture = createFixture();
    try {
      const options = { repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" };
      const result = executeMaintenance(options);
      const prior = readCurrentMaintenanceReport(result.outputs.directory).generation;
      writeFileSync(fixture.policyPath, JSON.stringify({ schemaVersion: 1 }), "utf8");
      expect(() => executeMaintenance(options)).toThrow(MaintenanceError);
      expect(readCurrentMaintenanceReport(result.outputs.directory).generation).toBe(prior);
      writeFileSync(fixture.policyPath, JSON.stringify(policyFor(fixture.baseline, fixture.originBare, fixture.upstreamBare)), "utf8");
      const upstream = join(fixture.root, "malformed package upstream");
      git(fixture.root, "clone", "-q", fixture.upstreamBare, upstream);
      git(upstream, "config", "user.email", "test@example.test");
      git(upstream, "config", "user.name", "Test");
      for (const malformed of [[], { dependencies: [] }, { devDependencies: { package: 1 } }, { peerDependencies: { package: null } }, { optionalDependencies: "invalid" }, { engines: { node: 22 } }, { packageManager: {} }]) {
        write(upstream, "package.json", JSON.stringify(malformed));
        commit(upstream, "malformed package metadata");
        git(upstream, "push", "-q", "origin", "main");
        expect(() => executeMaintenance(options)).toThrow(MaintenanceError);
        expect(readCurrentMaintenanceReport(result.outputs.directory).generation).toBe(prior);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("detects rename-versus-edit overlap through both old and new paths", () => {
    const fixture = createFixture();
    try {
      const upstream = join(fixture.root, "rename upstream");
      git(fixture.root, "clone", "-q", fixture.upstreamBare, upstream);
      git(upstream, "config", "user.email", "test@example.test");
      git(upstream, "config", "user.name", "Test");
      write(upstream, "rename-me.txt", "base\n");
      commit(upstream, "add rename target");
      git(upstream, "push", "-q", "origin", "main");
      // This fixture's configured baseline predates the added file; use a new common seed instead.
      const shared = join(fixture.root, "rename shared");
      git(fixture.root, "init", "--initial-branch=main", "-q", shared);
      git(shared, "config", "user.email", "test@example.test");
      git(shared, "config", "user.name", "Test");
      write(shared, "package.json", "{}\n");
      write(shared, "old-name.txt", "base\n");
      commit(shared, "base");
      const base = git(shared, "rev-parse", "HEAD");
      const origin = join(fixture.root, "rename-origin.git");
      const upstreamBare = join(fixture.root, "rename-upstream.git");
      git(fixture.root, "clone", "--bare", "-q", shared, origin);
      git(fixture.root, "clone", "--bare", "-q", shared, upstreamBare);
      const fork = join(fixture.root, "rename-fork");
      git(fixture.root, "clone", "-q", origin, fork);
      git(fork, "config", "user.email", "test@example.test");
      git(fork, "config", "user.name", "Test");
      git(fork, "remote", "add", "upstream", upstreamBare);
      git(fork, "mv", "old-name.txt", "new-name.txt");
      commit(fork, "rename");
      git(fork, "push", "-q", "origin", "main");
      const upstreamWork = join(fixture.root, "rename-upstream-work");
      git(fixture.root, "clone", "-q", upstreamBare, upstreamWork);
      git(upstreamWork, "config", "user.email", "test@example.test");
      git(upstreamWork, "config", "user.name", "Test");
      write(upstreamWork, "old-name.txt", "upstream edit\n");
      commit(upstreamWork, "edit old name");
      git(upstreamWork, "push", "-q", "origin", "main");
      const policyPath = join(fixture.root, "rename-policy.json");
      writeFileSync(policyPath, JSON.stringify(policyFor(base, origin, upstreamBare)), "utf8");
      const configEnvironment = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
      const previousEnvironment = Object.fromEntries(configEnvironment.map((name) => [name, process.env[name]]));
      let report;
      try {
        process.env.GIT_CONFIG_COUNT = "1";
        process.env.GIT_CONFIG_KEY_0 = "diff.renames";
        process.env.GIT_CONFIG_VALUE_0 = "false";
        report = executeMaintenance({ repo: fork, policyPath, outputDir: "../rename-reports" }).report;
      } finally {
        for (const name of configEnvironment) {
          if (previousEnvironment[name] === undefined) delete process.env[name];
          else process.env[name] = previousEnvironment[name];
        }
      }
      expect(report.pathOverlap).toMatchObject([{ matchedPaths: ["old-name.txt"], signal: "rename-aware", fork: { oldPath: "old-name.txt", path: "new-name.txt" }, upstream: { path: "old-name.txt" } }]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects unexpected remote identities before fetching", () => {
    const fixture = createFixture();
    try {
      const policy = policyFor("a".repeat(40), "https://invalid.example/origin.git", "https://invalid.example/upstream.git");
      writeFileSync(fixture.policyPath, JSON.stringify(policy), "utf8");
      expect(() => executeMaintenance({ repo: fixture.fork, policyPath: fixture.policyPath, outputDir: "../reports" })).toThrow("Remote origin identity differs from policy");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
