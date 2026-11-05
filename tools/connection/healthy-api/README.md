# healthy-api

Go program for concurrent multi-service checks with rules and optional alerts. This is the backup checker next to api-health. Connection Sentinel may use either. Do not run both against the same paid endpoint in a loop.

- Canonical name: healthy-api
- Upstream: https://github.com/mosishon/healthy-api
- Pin: `upstream/healthy-api` at `23fbfbb444f41c7f9bcfdc4a3a6958487baddbe8`
- License: MIT
- Registry name: `healthy-api`

## Invoke

Presence, no network and no Go required:

```bash
git -C upstream/healthy-api rev-parse HEAD
test -f upstream/healthy-api/main.go
test -f upstream/healthy-api/go.mod
```

When Go is installed, from `upstream/healthy-api`:

```bash
go run main.go -h
```

A real watch needs an untracked `config.yaml` copied from `sample.yaml`. Replace every sample webhook, phone number, and password. Do not commit that file.

## Environment names

The upstream sample keeps SMTP and webhook settings inside the YAML file, not in process environment variables. Treat `password`, `Authorization`, and webhook URLs as secrets. Never commit them.

## Evidence

Record the pin and, if you ran a check, the service name, the condition id, and pass or fail. Do not paste the config file.

## Rollback

`git submodule deinit -f upstream/healthy-api && git rm -f upstream/healthy-api`, then remove the registry, bootstrap, and catalog rows.
