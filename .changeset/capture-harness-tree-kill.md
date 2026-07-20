---
"@jmfederico/pi-web": patch
---

Fix the screenshot capture harness leaking server processes on Windows. Servers
are launched through `.cmd` shims (`shell: true`), so the tracked handle is a
`cmd.exe` wrapper and `child.kill()` orphaned the real Node servers underneath.
`terminate()` now tree-kills by pid via `taskkill /T /F` on Windows before the
normal signal, so a capture run cleans up after itself.
