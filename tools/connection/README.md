# Connection tools

Connection Sentinel and Integration Verifier use these pins. Source checkouts live under `upstream/`. Secrets stay outside git.

| Name | Pin | Invoke |
|---|---|---|
| api-health | `upstream/api-health` | [api-health/README.md](api-health/README.md) |
| healthy-api | `upstream/healthy-api` | [healthy-api/README.md](healthy-api/README.md) |
| OmniProbe | `upstream/omniprobe` | [omniprobe/README.md](omniprobe/README.md) |

Load the pins with `git submodule update --init upstream/api-health upstream/healthy-api upstream/omniprobe`.

`endpoints.example.json` lists public URLs only. Add private project URLs in an untracked file.
