---
"@jmfederico/pi-web": patch
---

Fix the Modernist assistant chat header overlapping the message text on mobile: the sticky header was transparent and let the scrolled content bleed through. It now uses an opaque page background so it occludes cleanly when pinned.
