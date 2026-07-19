import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const EXIT_NO_UPDATE = 0;
export const EXIT_UPDATE_AVAILABLE = 10;
export const EXIT_INVALID = 20;

const SHA = /^[0-9a-f]{40}$/;
const GENERATION = /^[0-9a-f]{64}$/;
const TAG_NAMESPACE = "refs/pi-web-maintenance/upstream/tags";
const MARKDOWN_METACHARACTERS = /([\\`*_{}\[\]<>()#+\-.!|~])/g;
const UNSAFE_CHARACTER = /[\u0000-\u0008\u0009-\u000d\u000e-\u001f\u007f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;
const LOCK_STALE_GRACE_MS = 60_000;

export class MaintenanceError extends Error {}

/** Fixed UTF-16 code-unit ordering; unlike localeCompare it is host-locale independent. */
export function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Makes untrusted Git/package text single-line and inert before it enters report data.
 * Control and bidi characters become visible \uXXXX escapes; HTML and mentions cannot render.
 */
export function sanitizeText(value) {
  return String(value)
    .replace(UNSAFE_CHARACTER, (character) => `\\u${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("@", "@\u200b")
    .trim();
}

/** Escapes every Markdown metacharacter after text has crossed the untrusted-data boundary. */
export function escapeMarkdown(value) {
  return sanitizeText(value).replace(MARKDOWN_METACHARACTERS, "\\$1");
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MaintenanceError(`${name} must be an object.`);
  }
}

function assertExactKeys(value, keys, name) {
  assertObject(value, name);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new MaintenanceError(`${name} contains unknown key ${key}.`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new MaintenanceError(`${name} is missing ${key}.`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new MaintenanceError(`${name} must be a non-empty string.`);
}

/** Strict, dependency-free validation so a malformed policy never produces a report. */
export function validatePolicy(policy) {
  assertExactKeys(policy, ["schemaVersion", "baseline", "remotes", "classifiers", "intentionalDivergence"], "policy");
  if (policy.schemaVersion !== 1) throw new MaintenanceError("policy.schemaVersion must be 1.");
  assertExactKeys(policy.baseline, ["sha", "releasedVersion"], "policy.baseline");
  assertString(policy.baseline.sha, "policy.baseline.sha");
  if (!SHA.test(policy.baseline.sha)) throw new MaintenanceError("policy.baseline.sha must be a full lowercase SHA.");
  assertString(policy.baseline.releasedVersion, "policy.baseline.releasedVersion");
  assertExactKeys(policy.remotes, ["origin", "upstream"], "policy.remotes");
  for (const remoteName of ["origin", "upstream"]) {
    const remote = policy.remotes[remoteName];
    assertExactKeys(remote, ["url", "ref"], `policy.remotes.${remoteName}`);
    assertString(remote.url, `policy.remotes.${remoteName}.url`);
    assertString(remote.ref, `policy.remotes.${remoteName}.ref`);
    if (remote.ref !== "refs/heads/main") throw new MaintenanceError(`policy.remotes.${remoteName}.ref must be refs/heads/main.`);
  }
  if (!Array.isArray(policy.classifiers) || policy.classifiers.length === 0) throw new MaintenanceError("policy.classifiers must be a non-empty array.");
  const classifierIds = new Set();
  for (const [index, classifier] of policy.classifiers.entries()) {
    assertExactKeys(classifier, ["id", "description", "pathGlobs"], `policy.classifiers[${index}]`);
    assertString(classifier.id, `policy.classifiers[${index}].id`);
    assertString(classifier.description, `policy.classifiers[${index}].description`);
    if (classifierIds.has(classifier.id)) throw new MaintenanceError(`policy.classifiers has duplicate id ${classifier.id}.`);
    classifierIds.add(classifier.id);
    assertGlobs(classifier.pathGlobs, `policy.classifiers[${index}].pathGlobs`);
  }
  if (!Array.isArray(policy.intentionalDivergence) || policy.intentionalDivergence.length === 0) {
    throw new MaintenanceError("policy.intentionalDivergence must be a non-empty array.");
  }
  const divergenceIds = new Set();
  for (const [index, entry] of policy.intentionalDivergence.entries()) {
    assertExactKeys(entry, ["id", "description", "pathGlobs"], `policy.intentionalDivergence[${index}]`);
    assertString(entry.id, `policy.intentionalDivergence[${index}].id`);
    assertString(entry.description, `policy.intentionalDivergence[${index}].description`);
    if (divergenceIds.has(entry.id)) throw new MaintenanceError(`policy.intentionalDivergence has duplicate id ${entry.id}.`);
    divergenceIds.add(entry.id);
    assertGlobs(entry.pathGlobs, `policy.intentionalDivergence[${index}].pathGlobs`);
  }
  return policy;
}

function assertGlobs(globs, name) {
  if (!Array.isArray(globs) || globs.length === 0) throw new MaintenanceError(`${name} must be a non-empty array.`);
  for (const [index, glob] of globs.entries()) {
    assertString(glob, `${name}[${index}]`);
    if (glob.includes("\\") || glob.startsWith("/") || glob.includes("..")) {
      throw new MaintenanceError(`${name}[${index}] must be a repository-relative POSIX glob.`);
    }
  }
}

function run(command, args, cwd) {
  const env = { ...process.env };
  // Git exports repository-local variables to hooks. The checker always targets
  // its explicit cwd repositories and must not inherit a caller's source index.
  for (const name of ["GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_PREFIX", "GIT_WORK_TREE"]) {
    delete env[name];
  }
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, env });
  if (result.error) throw new MaintenanceError(`${command} failed to start: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function git(cwd, args, required = true) {
  const result = run("git", args, cwd);
  if (required && result.status !== 0) {
    throw new MaintenanceError(`git ${args.join(" ")} failed: ${sanitizeText(result.stderr || result.stdout)}`);
  }
  return result;
}

function gitText(cwd, args) {
  return git(cwd, args).stdout.trim();
}

function toRepoPath(path) {
  return path.replaceAll("\\", "/");
}

function globMatches(path, glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (character === "?") {
      pattern += "[^/]";
    } else {
      pattern += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`${pattern}$`).test(toRepoPath(path));
}

export function classifyPath(path, entries) {
  const normalized = toRepoPath(path);
  return entries.filter((entry) => entry.pathGlobs.some((glob) => globMatches(normalized, glob))).map((entry) => entry.id).sort(compareCodeUnits);
}

function parseNameStatus(output) {
  const tokens = output.split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    const isRenameOrCopy = /^(R|C)/.test(status);
    const oldPath = tokens[index++];
    const path = isRenameOrCopy ? tokens[index++] : oldPath;
    if (!path) throw new MaintenanceError("Git returned malformed NUL-delimited name-status output.");
    changes.push({ status, path: toRepoPath(path), oldPath: isRenameOrCopy ? toRepoPath(oldPath) : undefined });
  }
  return changes.sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.oldPath ?? "", b.oldPath ?? "") || compareCodeUnits(a.status, b.status));
}

function refFor(remote) {
  return `refs/remotes/${remote}/main`;
}

function createFetchRepository(repo, policy) {
  const temp = mkdtempSync(join(tmpdir(), "pi-web-upstream-maintenance-"));
  try {
    git(temp, ["init", "--bare", "--quiet"]);
    for (const remoteName of ["origin", "upstream"]) {
      const remote = policy.remotes[remoteName];
      const destination = refFor(remoteName);
      git(temp, ["fetch", "--no-write-fetch-head", "--no-tags", remote.url, `+${remote.ref}:${destination}`]);
    }
    git(temp, ["fetch", "--no-write-fetch-head", "--no-tags", policy.remotes.upstream.url, `+refs/tags/*:${TAG_NAMESPACE}/*`]);
    return temp;
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function verifySourceRemotes(repo, policy) {
  for (const remoteName of ["origin", "upstream"]) {
    const actual = gitText(repo, ["remote", "get-url", remoteName]);
    const expected = policy.remotes[remoteName].url;
    if (actual !== expected) throw new MaintenanceError(`Remote ${remoteName} identity differs from policy.`);
  }
}

function readCommitList(repo, base, ref) {
  const ids = gitText(repo, ["rev-list", "--reverse", ref, `^${base}`]).split("\n").filter(Boolean);
  return ids.map((sha) => {
    const [commitSha, subject = ""] = git(repo, ["show", "-s", "--format=%H%x00%s", sha]).stdout.trimEnd().split("\0");
    return { sha: commitSha, subject: sanitizeText(subject) };
  });
}

function readTags(repo) {
  const output = git(repo, ["for-each-ref", "--sort=refname", "--format=%(refname)\t%(objectname)", TAG_NAMESPACE]).stdout;
  return output.split("\n").filter(Boolean).map((line) => {
    const boundary = line.indexOf("\t");
    const ref = line.slice(0, boundary);
    const name = ref.slice(`${TAG_NAMESPACE}/`.length);
    const commit = gitText(repo, ["rev-parse", `${ref}^{commit}`]);
    return { name: sanitizeText(name), sha: commit };
  }).sort((a, b) => compareCodeUnits(a.name, b.name));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Reject structurally valid JSON that cannot safely be interpreted as package metadata. */
export function validatePackageMetadata(packageJson, name = "package.json") {
  if (!isPlainObject(packageJson)) throw new MaintenanceError(`${name} must be a plain object.`);
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "engines"]) {
    if (!(section in packageJson)) continue;
    const value = packageJson[section];
    if (!isPlainObject(value)) throw new MaintenanceError(`${name}.${section} must be a plain object when present.`);
    for (const [dependency, version] of Object.entries(value)) {
      if (typeof version !== "string") throw new MaintenanceError(`${name}.${section}.${dependency} must be a string.`);
    }
  }
  if ("packageManager" in packageJson && typeof packageJson.packageManager !== "string") {
    throw new MaintenanceError(`${name}.packageManager must be a string when present.`);
  }
  return packageJson;
}

function packageAt(repo, ref) {
  const content = git(repo, ["show", `${ref}:package.json`]).stdout;
  let packageJson;
  try {
    packageJson = JSON.parse(content);
  } catch {
    throw new MaintenanceError(`package.json at ${ref} is invalid JSON.`);
  }
  return validatePackageMetadata(packageJson, `package.json at ${ref}`);
}

export function comparePackageMetadata(originPackage, upstreamPackage) {
  validatePackageMetadata(originPackage, "origin package.json");
  validatePackageMetadata(upstreamPackage, "upstream package.json");
  const sections = ["dependencies", "devDependencies", "peerDependencies", "engines"];
  const result = {};
  for (const section of sections) {
    const origin = originPackage[section] ?? {};
    const upstream = upstreamPackage[section] ?? {};
    const keys = [...new Set([...Object.keys(origin), ...Object.keys(upstream)])].sort(compareCodeUnits);
    result[section] = keys.flatMap((name) => {
      const from = origin[name] ?? null;
      const to = upstream[name] ?? null;
      return from === to ? [] : [{ name: sanitizeText(name), origin: from === null ? null : sanitizeText(from), upstream: to === null ? null : sanitizeText(to) }];
    });
  }
  return result;
}

function changedPaths(repo, base, ref) {
  return parseNameStatus(git(repo, ["diff", "--find-renames=50%", "--name-status", "-z", base, ref]).stdout);
}

function changePaths(change) {
  return change.oldPath === undefined ? [change.path] : [change.oldPath, change.path];
}

function classifyChange(change, entries) {
  return [...new Set(changePaths(change).flatMap((path) => classifyPath(path, entries)))].sort(compareCodeUnits);
}

function mapChanges(changes, classifiers, divergence) {
  return changes.map((change) => ({
    ...change,
    path: sanitizeText(change.path),
    oldPath: change.oldPath === undefined ? undefined : sanitizeText(change.oldPath),
    classifiers: classifyChange(change, classifiers),
    divergence: classifyChange(change, divergence),
  }));
}

function mergeSimulation(repo, origin, upstream) {
  const result = git(repo, ["merge-tree", "--write-tree", origin, upstream], false);
  if (result.status !== 0 && result.status !== 1) throw new MaintenanceError(`git merge-tree failed: ${sanitizeText(result.stderr)}`);
  return { clean: result.status === 0, conflict: result.status === 1 };
}

function latestReachableTag(repo, upstream, tags) {
  const candidates = [...tags].sort((a, b) => compareCodeUnits(b.name, a.name));
  for (const tag of candidates) {
    if (git(repo, ["merge-base", "--is-ancestor", tag.sha, upstream], false).status === 0) return tag;
  }
  return null;
}

function releaseSummary(repo, upstream, tags) {
  const latest = latestReachableTag(repo, upstream, tags);
  return {
    latest,
    unreleased: latest === null ? readCommitList(repo, gitText(repo, ["rev-list", "--max-parents=0", upstream]), upstream) : readCommitList(repo, latest.sha, upstream),
  };
}

function markdownCode(value) {
  return `\`${escapeMarkdown(value)}\``;
}

function markdownText(value) {
  return escapeMarkdown(value);
}

export function renderMarkdown(report) {
  const lines = [
    "# PI WEB upstream maintenance report",
    "",
    `Baseline: ${markdownCode(report.baseline.sha)} (${markdownText(report.baseline.releasedVersion)})`,
    `Origin: ${markdownCode(report.refs.origin)}`,
    `Upstream: ${markdownCode(report.refs.upstream)}`,
    `Status: **${markdownText(report.status)}**`,
    "",
    "## Divergence",
    "",
    `- Fork-only commits: ${report.ancestry.leftCount}`,
    `- Upstream-only commits: ${report.ancestry.rightCount}`,
    `- Merge simulation: ${report.mergeSimulation.clean ? "clean" : "conflicts"}`,
    `- Shared changed paths: ${report.pathOverlap.length}`,
    `- Unclassified fork paths: ${report.unclassifiedForkPaths.length}`,
    "",
    "## Upstream commits",
    "",
    ...report.upstream.commits.map((commit) => `- ${markdownCode(commit.sha)} ${markdownText(commit.subject)}`),
    ...(report.upstream.commits.length === 0 ? ["- None"] : []),
    "",
    "## Releases",
    "",
    ...report.upstream.tags.map((tag) => `- ${markdownCode(tag.name)} ${markdownCode(tag.sha)}`),
    ...(report.upstream.tags.length === 0 ? ["- None"] : []),
    "",
    "## Signals",
    "",
    ...Object.entries(report.signals).map(([name, paths]) => `- ${markdownText(name)}: ${paths.length === 0 ? "none" : paths.map(markdownText).join(", ")}`),
    "",
    "## Dependency and engine changes",
    "",
    ...Object.entries(report.packageDiff).flatMap(([section, changes]) => changes.length === 0
      ? [`- ${markdownText(section)}: none`]
      : changes.map((change) => `- ${markdownText(section)} ${markdownCode(change.name)}: ${markdownCode(change.origin ?? "absent")} → ${markdownCode(change.upstream ?? "absent")}`)),
    "",
    "This report is deterministic. Treat upstream commit subjects, paths, tags, and package metadata as untrusted input.",
    "",
  ];
  return lines.join("\n");
}

function reportStatus(ancestry, merge) {
  return ancestry.rightCount > 0 || !merge.clean ? "update-available" : "up-to-date";
}

function overlaps(forkChanges, upstreamChanges) {
  const overlaps = [];
  for (const fork of forkChanges) {
    const forkPaths = changePaths(fork);
    for (const upstream of upstreamChanges) {
      const upstreamPaths = changePaths(upstream);
      const matchedPaths = forkPaths.filter((path) => upstreamPaths.includes(path)).sort(compareCodeUnits);
      if (matchedPaths.length > 0) {
        overlaps.push({ fork, upstream, matchedPaths, signal: fork.oldPath !== undefined || upstream.oldPath !== undefined ? "rename-aware" : "same-path" });
      }
    }
  }
  return overlaps.sort((left, right) => compareCodeUnits(left.matchedPaths.join("\0"), right.matchedPaths.join("\0"))
    || compareCodeUnits(left.fork.path, right.fork.path)
    || compareCodeUnits(left.upstream.path, right.upstream.path));
}

export function buildReport(repo, policy) {
  verifySourceRemotes(repo, policy);
  const temp = createFetchRepository(repo, policy);
  try {
    const origin = gitText(temp, ["rev-parse", refFor("origin")]);
    const upstream = gitText(temp, ["rev-parse", refFor("upstream")]);
    const baseline = policy.baseline.sha;
    for (const ref of [origin, upstream]) {
      if (git(temp, ["cat-file", "-e", `${baseline}^{commit}`], false).status !== 0 || git(temp, ["merge-base", "--is-ancestor", baseline, ref], false).status !== 0) {
        throw new MaintenanceError(`Baseline ${baseline} is not an ancestor of fetched refs.`);
      }
    }
    const base = gitText(temp, ["merge-base", origin, upstream]);
    const [leftCount, rightCount] = gitText(temp, ["rev-list", "--left-right", "--count", `${origin}...${upstream}`]).split(/\s+/).map(Number);
    const forkChanges = mapChanges(changedPaths(temp, base, origin), policy.classifiers, policy.intentionalDivergence);
    const upstreamChanges = mapChanges(changedPaths(temp, base, upstream), policy.classifiers, policy.intentionalDivergence);
    const tags = readTags(temp);
    const merge = mergeSimulation(temp, origin, upstream);
    const signals = Object.fromEntries(policy.classifiers.map((classifier) => [classifier.id, upstreamChanges.filter((change) => change.classifiers.includes(classifier.id)).map((change) => change.path).sort(compareCodeUnits)]));
    return {
      schemaVersion: 1,
      baseline: { ...policy.baseline },
      remotes: policy.remotes,
      refs: { origin, upstream, mergeBase: base },
      ancestry: { baselineIsAncestorOfOrigin: true, baselineIsAncestorOfUpstream: true, leftCount, rightCount },
      status: reportStatus({ rightCount }, merge),
      mergeSimulation: merge,
      upstream: { commits: readCommitList(temp, base, upstream), tags, releases: releaseSummary(temp, upstream, tags) },
      changes: { fork: forkChanges, upstream: upstreamChanges },
      pathOverlap: overlaps(forkChanges, upstreamChanges),
      unclassifiedForkPaths: forkChanges.filter((change) => change.divergence.length === 0).map((change) => change.path).sort(compareCodeUnits),
      unclassifiedUpstreamPaths: upstreamChanges.filter((change) => change.divergence.length === 0).map((change) => change.path).sort(compareCodeUnits),
      signals,
      packageDiff: comparePackageMetadata(packageAt(temp, origin), packageAt(temp, upstream)),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function outputDirectory(repo, requested) {
  if (requested) return resolve(repo, requested);
  const gitDir = gitText(repo, ["rev-parse", "--git-dir"]);
  return resolve(repo, gitDir, "pi-web-maintenance");
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

function generationId(json, markdown) {
  // The generation binds both representations, not merely the JSON report.
  return digest(`${digest(json)}\n${digest(markdown)}\n`);
}

function parseCurrentPointer(text) {
  let pointer;
  try { pointer = JSON.parse(text); } catch { throw new MaintenanceError("Current maintenance report pointer is invalid JSON."); }
  const keys = Object.keys(pointer ?? {}).sort(compareCodeUnits);
  const expected = ["generation", "jsonSha256", "markdownSha256", "schemaVersion"].sort(compareCodeUnits);
  if (keys.join("\0") !== expected.join("\0") || pointer.schemaVersion !== 2 || !GENERATION.test(pointer.generation)
    || !GENERATION.test(pointer.jsonSha256) || !GENERATION.test(pointer.markdownSha256)) {
    throw new MaintenanceError("Current maintenance report pointer is invalid.");
  }
  if (pointer.generation !== generationIdFromDigests(pointer.jsonSha256, pointer.markdownSha256)) {
    throw new MaintenanceError("Current maintenance report pointer generation does not bind its digests.");
  }
  return pointer;
}

function generationIdFromDigests(jsonDigest, markdownDigest) {
  return digest(`${jsonDigest}\n${markdownDigest}\n`);
}

function readPointerSnapshot(manifestPath, { validate = true } = {}) {
  if (!existsSync(manifestPath)) return null;
  const text = readFileSync(manifestPath, "utf8");
  return { text, pointer: validate ? parseCurrentPointer(text) : undefined };
}

function sameSnapshot(left, right) {
  return (left?.text ?? null) === (right?.text ?? null);
}

function atomicWrite(path, text) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function lockOwnerIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function staleLockSnapshot(path) {
  let snapshot;
  let age;
  try {
    snapshot = readFileSync(path, "utf8");
    age = Date.now() - statSync(path).mtimeMs;
  } catch (error) {
    throw new MaintenanceError(`Cannot inspect the existing report writer lock: ${error.code ?? String(error)}.`);
  }
  let owner;
  try { owner = JSON.parse(snapshot); } catch { owner = null; }
  const validOwner = owner !== null && typeof owner === "object" && !Array.isArray(owner)
    && Object.keys(owner).sort(compareCodeUnits).join("\0") === ["createdAt", "pid", "schemaVersion", "token"].sort(compareCodeUnits).join("\0")
    && owner.schemaVersion === 1 && Number.isInteger(owner.pid) && owner.pid > 0
    && Number.isFinite(owner.createdAt) && owner.createdAt > 0 && typeof owner.token === "string";
  if ((!validOwner && age < LOCK_STALE_GRACE_MS) || (validOwner && lockOwnerIsAlive(owner.pid))) return null;
  return snapshot;
}

function createOwnedLock(path) {
  const snapshot = `${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: Date.now(), token: randomUUID() })}\n`;
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, snapshot, "utf8");
    return { path, descriptor, snapshot };
  } catch (error) {
    closeSync(descriptor);
    if (existsSync(path) && readFileSync(path, "utf8") === snapshot) unlinkSync(path);
    throw error;
  }
}

function exitWriterLock(lock) {
  closeSync(lock.descriptor);
  if (readFileSync(lock.path, "utf8") !== lock.snapshot) {
    throw new MaintenanceError("Report writer lock ownership changed before release.");
  }
  unlinkSync(lock.path);
}

function enterWriterLock(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "writer.lock");
  const recoveryPath = join(directory, "writer.lock.recovery");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (existsSync(recoveryPath)) {
      const staleRecovery = staleLockSnapshot(recoveryPath);
      if (staleRecovery === null) throw new MaintenanceError("Another report writer is recovering a stale lock.");
      if (readFileSync(recoveryPath, "utf8") === staleRecovery) unlinkSync(recoveryPath);
      continue;
    }
    try {
      const lock = createOwnedLock(path);
      if (!existsSync(recoveryPath)) return lock;
      exitWriterLock(lock);
      continue;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        if (error instanceof MaintenanceError) throw error;
        throw new MaintenanceError(`Cannot acquire the report writer lock: ${error.code ?? String(error)}.`);
      }
    }

    const stale = staleLockSnapshot(path);
    if (stale === null) throw new MaintenanceError("Another report writer holds the exclusive lock.");
    let recovery;
    try {
      recovery = createOwnedLock(recoveryPath);
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw new MaintenanceError(`Cannot acquire the stale-lock recovery guard: ${error.code ?? String(error)}.`);
    }
    try {
      const current = staleLockSnapshot(path);
      if (current !== null && current === stale && readFileSync(path, "utf8") === stale) unlinkSync(path);
    } finally {
      exitWriterLock(recovery);
    }
  }
  throw new MaintenanceError("Cannot recover the stale report writer lock.");
}

function verifyGeneration(directory, json, markdown) {
  const jsonPath = join(directory, "upstream-report.json");
  const markdownPath = join(directory, "upstream-report.md");
  try {
    if (readFileSync(jsonPath, "utf8") !== json || readFileSync(markdownPath, "utf8") !== markdown) {
      throw new MaintenanceError(`Existing report generation ${basename(directory)} does not match its content digests.`);
    }
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    throw new MaintenanceError(`Existing report generation ${basename(directory)} is incomplete.`);
  }
}

/** Publishes a complete immutable generation under a lock with a compare-and-swap pointer. */
export function writeReport(repo, report, requestedOutputDirectory, { failAt, beforeLock } = {}) {
  const directory = outputDirectory(repo, requestedOutputDirectory);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  const jsonSha256 = digest(json);
  const markdownSha256 = digest(markdown);
  const generation = generationIdFromDigests(jsonSha256, markdownSha256);
  const generationsDirectory = join(directory, "generations");
  const destination = join(generationsDirectory, generation);
  const manifestPath = join(directory, "current.json");
  mkdirSync(generationsDirectory, { recursive: true });
  // Capture the expected pointer before waiting. A writer that began earlier cannot repoint over
  // a completed newer writer after it finally obtains the exclusive lock.
  const expected = readPointerSnapshot(manifestPath, { validate: false });
  if (beforeLock) beforeLock();
  const lock = enterWriterLock(directory);
  try {
    if (!sameSnapshot(expected, readPointerSnapshot(manifestPath, { validate: false }))) {
      throw new MaintenanceError("Current report pointer changed before this writer acquired the lock.");
    }
    try {
      mkdirSync(destination);
      writeFileSync(join(destination, "upstream-report.json"), json, { encoding: "utf8", flag: "wx" });
      writeFileSync(join(destination, "upstream-report.md"), markdown, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      verifyGeneration(destination, json, markdown);
    }
    if (failAt === "before-pointer") throw new MaintenanceError("Injected failure before current-generation pointer.");
    if (failAt === "at-pointer") throw new MaintenanceError("Injected failure at current-generation pointer.");
    const manifest = `${JSON.stringify({ schemaVersion: 2, generation, jsonSha256, markdownSha256 }, null, 2)}\n`;
    atomicWrite(manifestPath, manifest);
  } finally {
    exitWriterLock(lock);
  }
  return { directory, manifestPath, generation, jsonPath: join(destination, "upstream-report.json"), markdownPath: join(destination, "upstream-report.md") };
}

export function readCurrentMaintenanceReport(directory) {
  const resolvedDirectory = resolve(directory);
  const manifestPath = join(resolvedDirectory, "current.json");
  let pointer;
  try { pointer = readPointerSnapshot(manifestPath)?.pointer; } catch (error) { throw new MaintenanceError(`Cannot read current maintenance report: ${error.message}`); }
  if (!pointer) throw new MaintenanceError("Cannot read current maintenance report: current pointer is missing.");
  const generationDirectory = join(resolvedDirectory, "generations", pointer.generation);
  const jsonPath = join(generationDirectory, "upstream-report.json");
  const markdownPath = join(generationDirectory, "upstream-report.md");
  let json;
  let markdown;
  let report;
  try {
    json = readFileSync(jsonPath, "utf8"); markdown = readFileSync(markdownPath, "utf8");
    if (digest(json) !== pointer.jsonSha256 || digest(markdown) !== pointer.markdownSha256 || generationId(json, markdown) !== pointer.generation) {
      throw new MaintenanceError("Current maintenance report generation digest mismatch.");
    }
    report = JSON.parse(json);
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    throw new MaintenanceError(`Current maintenance report generation is incomplete: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { report, directory: resolvedDirectory, manifestPath, generation: pointer.generation, jsonPath, markdownPath };
}

export function loadPolicy(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new MaintenanceError(`Cannot read policy ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validatePolicy(parsed);
}

export function executeMaintenance({ repo = process.cwd(), policyPath = "maintenance/upstream-policy.json", outputDir, failureInjection } = {}) {
  const root = gitText(repo, ["rev-parse", "--show-toplevel"]);
  const policy = loadPolicy(isAbsolute(policyPath) ? policyPath : resolve(root, policyPath));
  const report = buildReport(root, policy);
  const outputs = writeReport(root, report, outputDir, { failAt: failureInjection });
  return { report, outputs, exitCode: report.status === "update-available" ? EXIT_UPDATE_AVAILABLE : EXIT_NO_UPDATE };
}
