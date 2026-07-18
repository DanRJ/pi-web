---
"@jmfederico/pi-web": patch
---

Restore session-daemon startup and authentication on supported Pi `>=0.80.8 <0.81` releases by migrating model and credential handling to `ModelRuntime`. Login options now follow each provider's interactive API-key and OAuth capabilities, provider-driven API-key setup supports multi-step prompts while legacy one-secret clients still fail safely before storing malformed credentials, OAuth prompts retain their input, selection, and device-code semantics, and committed login remains truthful when cancellation races the final refresh. PI WEB now requires Node.js `>=22.19.0`.
