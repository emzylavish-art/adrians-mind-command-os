# Tool verification records

GitHub-sourced tools (and GodEye / God's Eyes) stay **unverified** and are not callable until a JSON record exists here.

Record file name: `<slug>.json` (slug = lowercased tool name with non-alnum → `-`).

Required fields:
```json
{
  "toolName": "Exact Name From registry.json",
  "verifiedAt": "2026-11-02T00:00:00Z",
  "evidence": "short proof (test command, CI job, or live probe id)",
  "verifiedBy": "optional agent or person"
}
```
