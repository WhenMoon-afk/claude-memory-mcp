---
name: memory:connect
description: Connect to Substratia Cloud for backup and sync
args:
  - name: api_key
    description: Your Substratia API key
    required: false
---

{{#if api_key}}
Connect to Substratia Cloud using `memory_cloud action:connect api_key:{{api_key}}`.

After connecting, memories will automatically sync to the cloud, enabling:
- Cloud backup (never lose memories)
- Cross-device sync
- Web dashboard at substratia.io/dashboard
{{else}}
## Get Your API Key

1. **Go to** https://substratia.io/dashboard
2. **Sign up** or log in
3. **Subscribe** to Pro ($9/month) for cloud sync
4. **Copy** your API key from the dashboard
5. **Run**: `/memory:connect YOUR_API_KEY`

**Why cloud sync?**
- Access memories from any device
- Never lose your data (automatic backups)
- Search and manage memories from the web

**Free tier** gives you unlimited local memories. Cloud sync is optional.
{{/if}}
