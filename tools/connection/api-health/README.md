# api-health

Zero-dependency Node CLI. It checks one URL or a JSON list, records status and latency, can check SSL, and can watch on an interval.

- Canonical name: api-health
- Upstream: https://github.com/lxgicstudios/api-health
- Pin: `upstream/api-health` at `4376ac6091ba93d9cce6f614a50861b99d689150`
- License: MIT
- Registry name: `api-health`
- Package name: `@lxgicstudios/api-health` (run the pin; do not install a different package)

## Invoke

Help does not touch the network:

```bash
node --experimental-strip-types upstream/api-health/src/index.ts --help
```

Probe the public example list once. A 401 still means the host answered.

```bash
node --experimental-strip-types upstream/api-health/src/index.ts --file tools/connection/endpoints.example.json --json --timeout 8000
```

Watch mode is `--watch` plus `--interval`. Do not leave a watch running inside a bootstrap.

## Environment names

None. Do not put bearer tokens in the JSON file. If a check needs a header, pass it only in the process environment for that run and do not log it.

## Evidence

Save the JSON result: name, HTTP status, and latency in milliseconds. Say which file was probed.

## Rollback

`git submodule deinit -f upstream/api-health && git rm -f upstream/api-health`, then remove the registry, bootstrap, and catalog rows.
