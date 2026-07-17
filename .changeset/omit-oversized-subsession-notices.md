---
"@jmfederico/pi-web": patch
---

Omit oversized tracked-subsession output from parent completion notices, directing the parent to retrieve the full result with `check_subsession` instead of duplicating a truncated preview in context.
