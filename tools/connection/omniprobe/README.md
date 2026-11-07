# OmniProbe

Pure-frontend tester for OpenAI-compatible endpoints. A ping is not enough: the depth check asks the model to perform a function call and records whether the tool call came back. Keys stay in the browser.

The upstream repository is `ssrsgaga/API-Check`. Its README titles the app OmniProbe. `GenIntel/OmniProbe` is a vision-backbone probe and is not this tool.

- Canonical name: OmniProbe
- Upstream: https://github.com/ssrsgaga/API-Check
- Pin: `upstream/omniprobe` at `292a011be478a3fdb348dd672c75d6bc0a6f114d`
- License: MIT
- Registry name: `OmniProbe`

## Invoke

```bash
git -C upstream/omniprobe rev-parse HEAD
test -f upstream/omniprobe/index.html
test -f upstream/omniprobe/package.json
```

To open the UI locally, install and start only on a trusted machine:

```bash
npm --prefix upstream/omniprobe install
npm --prefix upstream/omniprobe run dev
```

The smoke command for the fleet is the pair of `test -f` checks. Do not start the dev server from bootstrap.

The pin contains `upstream/omniprobe/.env.local` with a placeholder `GEMINI_API_KEY`. Do not copy it. Do not replace it with a real key in git.

## Environment names

`GEMINI_API_KEY` is the only name in that placeholder file. Runtime keys for OpenAI-compatible providers are typed into the browser and stored in local storage. They are not repository environment variables.

## Evidence

Record the pin, the base URL host (not the key), the model id, and whether the function-call check passed, failed, or was not run. A successful chat with no tool call is a failed verification.

## Rollback

`git submodule deinit -f upstream/omniprobe && git rm -f upstream/omniprobe`, then remove the registry, bootstrap, and catalog rows.
