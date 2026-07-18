---
"@jmfederico/pi-web": patch
---

Keep auth interactions bound to their originating machine and cancel flows created after their browser start operation becomes stale, preventing secrets from reaching the wrong remote or abandoned provider resources from surviving a closed dialog.
