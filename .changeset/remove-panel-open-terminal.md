---
"@jmfederico/pi-web": patch
---

Clean up the workspace panel plugin context by moving render invalidation to `context.host.requestRender()` and deprecating the legacy runtime-only `openTerminal` alias in favor of `context.terminal.open()`.
