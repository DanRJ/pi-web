import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));

describe("Windows local deployment wrapper", () => {
  it.skipIf(process.platform !== "win32")("runs only fake-descriptor PowerShell self-tests", async () => {
    const script = join(root, "LocalDeployment.SelfTest.ps1");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File", script], { windowsHide: true });
    expect(stdout).toContain("self-tests passed");
  });
});
