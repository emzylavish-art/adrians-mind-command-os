# LangGraph.js

Candidate id: langgraph-js. Name: LangGraph.js. Classification: evaluation-only. This note does not approve or install it.

Official source: [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs). The repository is public, not archived, and not disabled. Its homepage field is [https://docs.langchain.com/oss/javascript/langgraph/](https://docs.langchain.com/oss/javascript/langgraph/). The JavaScript overview is [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview). npm package `@langchain/langgraph` lists that same GitHub repository, with the package directory `libs/langgraph-core`. The README says LangChain Inc builds it and that it can be used without LangChain. This is not the Python repository [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph).

Version: 1.7.4 is the current stable release, not a guessed label. The GitHub release tag is `@langchain/langgraph@1.7.4`, published 2026-11-12T18:06:18Z, not a draft and not a prerelease. The tag points at commit `572657e381fdf5c421904169b0f8c7c54f7f68d4`, committed 2026-11-12T18:03:22Z, with the message `chore: version packages (#3322)`. The package file at that commit sets `"version": "1.7.4"` and `"license": "MIT"`. npm dist-tag `latest` is 1.7.4, published 2026-11-12T18:09:51.308Z. Other dist-tags are `alpha` `1.0.0-alpha.1`, `next` `1.0.1`, and `rc` `1.4.18-rc.0`. Those are not the candidate. The GitHub latest-release endpoint returned a different monorepo package, `@langchain/langgraph-cli@1.7.2`, published 2026-11-12T18:06:36Z. That CLI release is not this candidate. The npm HTML page was stale and showed 1.6.0; the registry record is the one used here.

License: MIT, copyright 2024 LangChain. The LICENSE file on `main` matches the MIT text, and both the 1.7.4 tag `package.json` and the npm 1.7.4 record say MIT. The license allows use, modification, and sale of the software if the copyright and permission notice stay with copies. It gives no warranty. That is not a license block.

Commercial: the library is free under MIT. Hosted LangSmith is a separate paid service. On 2026-11-15 the official pricing page listed Developer at $0 per seat per month, Plus at $39 per seat per month, and Enterprise as custom pricing, each with pay-as-you-go usage. Developer includes up to 5,000 base traces per month and does not include Agent Server. Plus includes up to 10,000 base traces and one small serverless Agent Server, with more servers billed by resource usage. One LangChain Standard Unit is $1. Exact usage for an Adrian Mind graph is unverified. This research created no account and spent no money.

Activity: at check time the GitHub repository showed 3,416 stars, 642 forks, and an open-issue count of 235. That count includes pull requests. `created_at` was 2024-01-09T17:40:12Z. `pushed_at` was 2026-11-14T03:40:00Z. The newest commit on `main` at check time was `fa426b293b6ecccbf62b4f262475777b4bf86673`, dated 2026-11-14T01:24:28Z, which is after the 1.7.4 tag. npm recorded 5,034,429 downloads of `@langchain/langgraph` from 2026-11-08 through 2026-11-14. Maintainers on the npm record are `lc-oss-admin` and `langchain-security`.

Runtime: TypeScript library for stateful agent graphs. The published package is `"type": "module"`, with an ESM entry at `./dist/index.js` and a CommonJS entry at `./dist/index.cjs`. It also publishes `./web`, `./zod`, `./pregel`, `./remote`, `./stream`, `./channels`, and `./prebuilt`. Engines require Node.js `>=18`. There is no bin. Official docs install it with `@langchain/core`. The graph can persist checkpoints, pause for a person, stream events, and call tools the application supplies. None of that was executed.

Install size: not measured on disk, because nothing was installed. The published npm package reports an unpacked size of 4,621,381 bytes, about 4.41 MiB, across 636 files. That figure does not include `@langchain/core`, `zod`, or the four direct dependencies. Transitive install size is unverified.

Dependencies: the published 1.7.4 record depends on `@langchain/protocol` `^0.0.21`, `@standard-schema/spec` `1.1.0`, `@langchain/langgraph-sdk` `~1.16.0`, and `@langchain/langgraph-checkpoint` `^1.2.2`. Peer dependencies are `@langchain/core` `^1.3.4` and `zod` `^3.25.32 || ^4.2.0`. The published scripts include `prepublish` and test scripts. They do not include `preinstall`, `install`, or `postinstall`. Postgres, Redis, and MongoDB checkpointers are separate packages and are not direct dependencies of 1.7.4. Transitive dependency risk was not audited.

Security: the candidate version is outside the published vulnerable ranges found for `@langchain/langgraph` itself. GitHub lists a high advisory, [GHSA-wp87-994x-j95x](https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-wp87-994x-j95x), for graph input interpreted as a control directive in `>= 0.2.23, < 1.4.21`, patched in 1.4.21. A low advisory, [GHSA-432w-3h3v-2pv4](https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-432w-3h3v-2pv4), also names `@langchain/langgraph` below 1.4.21. A high deserialization advisory, [GHSA-j87f-x5h5-gr75](https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-j87f-x5h5-gr75), covers `@langchain/langgraph` below 1.4.12 for the 1.x line, patched in 1.4.12, and `@langchain/langgraph-checkpoint` below 1.1.4 for the 1.x line. Version 1.7.4 depends on checkpoint `^1.2.2` and SDK `~1.16.0`. Related store packages still have published advisories, including high [GHSA-8p8h-xj5r-m5wf](https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-8p8h-xj5r-m5wf) for namespace isolation in Postgres and Redis stores. Those packages are not direct dependencies of this release. No new vulnerability scan of 1.7.4 was run.

Secrets: the library does not ship an account or a key. Official LangSmith tracing uses `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_AGENT_ID`, and `LANGSMITH_AGENT_ENVIRONMENT` when that tracing is turned on. A graph that calls a model still needs that model's provider key in the application. No secret was read or written for this check.

Integration: Adrian Mind does not import `@langchain/langgraph`. The product `package.json` has no LangChain dependency. A vendored upstream lock under `upstream/n8n-mcp` records older copies, including 1.5.2 and 1.0.2, and those are not the product install. Adding 1.7.4 would be a new orchestration library, not an upgrade of the current Chat, Build, or Speak runtime. It was not added.

Compatibility: the product TypeScript range is `^5.7.0` and `zod` is `^4.4.0`, which satisfies the published peer range. `@langchain/core` is absent and would have to be added with the library. The sandbox Node is v22.23.4, which meets `>=18`. Whether the package bundles cleanly into the current Vite preview is unverified. LangGraph 1.0 remains the documented LTS line until 2.0. After 2.0, docs say 1.0 stays in maintenance for at least one year. A 1.7.4 pin is inside that 1.x line. Safe minor upgrades are a documentation claim, not a local test.

Risks: the library can persist thread state and run application tools, so a later trial can retain private conversation data and can act on the workspace if a tool is given that power. Optional database stores have had cross-namespace flaws, so they should not be treated as tenant isolation without a separate review. LangSmith tracing can send run content to LangChain's service if the environment variables are set. The monorepo moved past the 1.7.4 tag on 2026-11-14, so `main` is not the same as the published package. No code review of 1.7.4 was done.

Maintenance: LangChain Inc publishes the repository and the npm package. The 1.7.4 release was a Changesets version bump on 2026-11-12, and `main` still received commits through 2026-11-14. Official versioning docs keep LangGraph 1.0 active until 2.0, then in maintenance for at least one year. Support beyond that policy page is unverified.

Rollback: do not add `@langchain/langgraph` to the product manifest or lockfile. If a later trial installs it, remove that package and its added peers from the manifest, then reinstall from the previous lockfile. Nothing was installed, so there is no package to remove.

Classification: evaluation-only. Identity is confirmed. The license does not block review. The published advisories against `@langchain/langgraph` do not include 1.7.4, so security does not block a paper review. It is not approved and not installed.

## References

[1]: https://github.com/langchain-ai/langgraphjs "LangGraph.js repository"
[2]: https://github.com/langchain-ai/langgraphjs/releases/tag/%40langchain/langgraph%401.7.4 "LangGraph.js 1.7.4 GitHub release"
[3]: https://github.com/langchain-ai/langgraphjs/commit/572657e381fdf5c421904169b0f8c7c54f7f68d4 "LangGraph.js 1.7.4 version commit"
[4]: https://registry.npmjs.org/@langchain/langgraph/1.7.4 "npm record for @langchain/langgraph 1.7.4"
[5]: https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/LICENSE "MIT license on main"
[6]: https://docs.langchain.com/oss/javascript/langgraph/overview "LangGraph JavaScript overview"
[7]: https://docs.langchain.com/oss/javascript/versioning "LangChain JavaScript versioning policy"
[8]: https://www.langchain.com/pricing "LangSmith plans and pricing"
[9]: https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-wp87-994x-j95x "Graph input control-directive advisory"
[10]: https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-j87f-x5h5-gr75 "JsonPlusSerializer deserialization advisory"
[11]: https://docs.langchain.com/langsmith/trace-without-env-vars "LangSmith tracing environment variables"
