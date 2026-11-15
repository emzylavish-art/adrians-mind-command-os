# Kimi Code 2.6.2

Candidate id: kimi-code. Name: Kimi Code 2.6.2. Classification: evaluation-only. This note does not approve or install it.

Official source: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code). The repository homepage is [https://www.kimi.com/code/docs/](https://www.kimi.com/code/docs/). Moonshot AI also documents the product at [Kimi Code help](https://www.kimi.com/en/help/kimi-code). The CLI docs are at [moonshotai.github.io/kimi-code](https://moonshotai.github.io/kimi-code/en/).

Version: 2.6.2 is a real stable release, not a guessed label. The GitHub release tag is `@moonshot-ai/kimi-code@2.6.2`, published 2026-11-13T17:20:51Z, not a draft and not a prerelease. A later check of the GitHub latest-release endpoint returned that same tag. The tag commit is `6a8493df3e1d796a63f7c7ca0de76c1e690cd943`. The package file at that tag sets `"version": "2.6.2"`. npm dist-tag `latest` is 2.6.2. The official changelog labels the same release 2.6.2 (2026-11-14), which matches the publish time in China Standard Time. A newer canary exists, npm dist-tag `canary` `2.7.0-canary.20261113055733-391d9e7`, and it is not the candidate. Adrian Mind currently pins `@moonshot-ai/kimi-code` at `^2.5.3`, and the lockfile resolves exactly 2.5.3. That older pin was not changed.

License: MIT, copyright 2026 Moonshot AI. The LICENSE file at commit `6a8493df` matches the MIT text, and both the tag `package.json` and the npm 2.6.2 record say MIT. The license allows use, modification, and sale of the software if the copyright and permission notice stay with copies. It gives no warranty. That is not a license block.

Commercial: the CLI source is free under MIT. Using Moonshot's hosted Kimi Code service is separate and paid. On 2026-11-15 the official membership page listed Plus at $19 per month or $15 per month billed annually, Pro at $39 or $31, Max at $99 or $79, and Ultra at $199 or $159, and those paid plans list Kimi Code as available. The free row does not. API use is billed by token, with prices varying by model. The help page does not print the model table. It points to the platform pricing docs. Exact API rates are unverified here. This research created no account and spent no money.

Activity: the GitHub repository was public and not archived. At check time it showed 8,228 stars, 1,379 forks, and 1,844 open issues. `pushed_at` was 2026-11-15T07:42:17Z. Releases are active through 2.6.2 on 2026-11-13, with canary tags also present. Security support, per SECURITY.md, covers only the latest released version.

Runtime: TypeScript coding agent. The recommended install is a single binary from `https://code.kimi.com/kimi-code/install.sh`, which the docs say does not require Node.js. The npm package `@moonshot-ai/kimi-code` requires Node.js `>=22.19.0` and exposes the `kimi` bin at `dist/main.mjs`. Developing the monorepo requires Node.js `>=24.15.0` and pnpm 10.33.0. Windows needs Git for Windows because the CLI uses Git Bash. Platforms published for 2.6.2 are darwin, linux, and win32, each in arm64 and x64.

Install size: not measured on disk, because nothing was installed. The published npm package reports an unpacked size of 52,828,917 bytes, about 50.38 MiB. The official compressed Linux x64 binary `kimi-code-linux-x64.zst` is 48,370,283 bytes, about 46.13 MiB. The Linux x64 zip is 64,437,414 bytes. Extracted install size is unverified.

Dependencies: the published 2.6.2 npm record depends on `chokidar` `^4.0.3`, `qrcode` `^1.5.4`, and `ws` `^8.18.0`, with optional `@mariozechner/clipboard` `^0.3.9`. Workspace packages such as `@moonshot-ai/kimi-code-sdk`, `@moonshot-ai/agent-core-v2`, and `@moonshot-ai/kimi-code-oauth` are declared as dev dependencies of the app and are not the published runtime dependency list. The package has a `postinstall` script. The 2.5.3 lock entry already records `hasInstallScript: true`. Transitive dependency risk was not audited.

Security: the public GitHub security-advisories list for the repository was empty at check time. That is not a vulnerability scan. SECURITY.md asks for private reports through GitHub Security Advisories or `code@moonshot.ai`, and says only the latest release is supported. The agent can read and edit files, run shell commands, search, fetch pages, load MCP servers, run hooks, and schedule tasks. Read-only tools run without confirmation by default. File changes and shell commands ask first, but permission modes and `dangerous_command_guard = false` can weaken that. The recommended install is a remote script piped to a shell. The 2.6.2 notes say `/feedback` shows the current session files before confirmation and no longer offers a text-only submission. Remote control and `kimi web` are documented features. None of this was executed.

Secrets: login is `/login`, either Kimi Code OAuth or a Kimi Platform API key from `platform.kimi.com` or `platform.kimi.ai`. `/logout` clears the current credentials. Ordinary provider keys are stored in `~/.kimi-code/config.toml`, or under `KIMI_CODE_HOME`. The docs say exporting `KIMI_API_KEY` in the shell does not by itself configure a provider, unless `api_key_env` or the `KIMI_MODEL_*` path is used. OAuth tokens and sessions live under the data directory. Telemetry is on unless `KIMI_DISABLE_TELEMETRY` is set. No secret was read or written for this check.

Integration: Adrian Mind already runs this package from `node_modules/@moonshot-ai/kimi-code/dist/main.mjs` and speaks to it as an ACP-style coding process. Build is documented as running that process with Kimi login stripped and the saved Grok key. Plugin catalog code expects a connected Kimi Code token before it will load Kimi's catalog. A 2.6.2 bump would be an upgrade of that existing runtime, not a new product identity. It was not performed.

Compatibility: the candidate matches the package Adrian already imports. The lockfile is one minor version behind, at 2.5.3. One local launcher path points at Node v22.13.0, which is below the 2.6.2 engine floor of 22.19.0. Whether 2.6.2 still starts on 22.13.0 is unverified. Official ACP support covers Zed, JetBrains, and `kimi acp`. Third-party providers, including OpenAI-compatible endpoints, are documented, which is how a Grok key can be used without a Kimi membership. That path was not retested on 2.6.2.

Risks: an upgrade can change shell approval, feedback uploads, auto-update, telemetry, and the postinstall script. `kimi upgrade` can move the binary unless `KIMI_CODE_NO_AUTO_UPDATE` is set. Hosted Kimi Code still needs a paid membership or API balance. The coding agent can modify the workspace it is pointed at. Official single-binary and npm sizes differ, so an install path must be chosen before any later trial. No CVE was found in the public advisory list, and no code review of 2.6.2 was done.

Maintenance: Moonshot AI publishes the repo and the npm package. Releases continued from the project's known 2.5.3 pin to 2.6.0, 2.6.1, and 2.6.2 between 2026-11-12 and 2026-11-13, with changelog notes through 2026-11-14. Security fixes are promised only for the latest release. Support email in SECURITY.md is `code@moonshot.ai`.

Rollback: leave the lockfile on `@moonshot-ai/kimi-code@2.5.3`. Do not run `kimi upgrade` or change the package range. If a later trial installs the npm package, `npm uninstall -g @moonshot-ai/kimi-code` removes a global install. A script install is removed by deleting the `kimi` binary. Local data under `~/.kimi-code` would still need a separate decision. Nothing was installed, so there is no new binary to roll back.

Classification: evaluation-only. Identity is confirmed. The license does not block review. No public advisory blocks review. It is not approved and not installed.

## References

[1]: https://github.com/MoonshotAI/kimi-code "MoonshotAI Kimi Code repository"
[2]: https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai%2Fkimi-code%402.6.2 "Kimi Code 2.6.2 GitHub release"
[3]: https://github.com/MoonshotAI/kimi-code/blob/6a8493df3e1d796a63f7c7ca0de76c1e690cd943/LICENSE "MIT license at the 2.6.2 commit"
[4]: https://registry.npmjs.org/@moonshot-ai/kimi-code/2.6.2 "npm record for @moonshot-ai/kimi-code 2.6.2"
[5]: https://moonshotai.github.io/kimi-code/en/release-notes/changelog.html "Kimi Code CLI changelog"
[6]: https://moonshotai.github.io/kimi-code/en/guides/getting-started.html "Kimi Code CLI getting started"
[7]: https://moonshotai.github.io/kimi-code/en/configuration/providers.html "Kimi Code providers and models"
[8]: https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html "Kimi Code environment variables"
[9]: https://raw.githubusercontent.com/MoonshotAI/kimi-code/6a8493df3e1d796a63f7c7ca0de76c1e690cd943/SECURITY.md "Security policy at the 2.6.2 commit"
[10]: https://www.kimi.com/membership/pricing "Kimi membership pricing"
[11]: https://www.kimi.com/en/help/kimi-api/api-pricing "Kimi API billing guide"
