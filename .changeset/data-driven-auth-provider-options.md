---
"@jmfederico/pi-web": patch
---

Offer API-key and OAuth login options for every provider the agent backend supports each method for, instead of a curated hardcoded list. Providers that support both methods (such as Anthropic and GitHub Copilot) now surface both an API-key and an OAuth login option, driven purely by what the backend reports.
