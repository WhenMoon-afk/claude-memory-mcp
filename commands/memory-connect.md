---
name: memory:connect
description: Connect to Substratia Cloud for backup and sync
args:
  - name: api_key
    description: Your Substratia API key (get one at substratia.io/dashboard)
    required: true
---

Connect to Substratia Cloud using `memory_cloud action:connect api_key:{{api_key}}`.

After connecting, memories will automatically sync to the cloud on store, enabling:
- Cloud backup (never lose memories)
- Cross-device sync
- Web dashboard access at substratia.io/dashboard
