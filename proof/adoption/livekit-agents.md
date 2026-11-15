# LiveKit Agents JS

Classification: evaluation-only. Not installed. Not callable.

- Official repository: https://github.com/livekit/agents-js
- npm package checked: `@livekit/agents` 1.10.0
- License: Apache-2.0 on the GitHub repository and on the npm record
- Activity: public, not archived. At check: 965 stars, 431 forks, 556 open issues including pull requests, pushed 2026-11-14
- GitHub latest-release endpoint returned `@livekit/agents-plugin-synthesia@1.10.0` on 2026-11-13. That is a plugin tag, not this SDK
- Runtime: Node.js agent framework. npm record did not publish an engines field. Dependencies seen on 1.10.0 include ws, pino, sharp, ofetch, openai, and `@livekit/av`
- Install size: not measured on disk. npm unpacked size for 1.10.0 is 36,439,199 bytes. That excludes a LiveKit server
- Commercial: the package license allows commercial use. LiveKit Cloud is a separate paid service. No account was created and no money was spent
- Secrets: a running agent needs LiveKit URL, API key, and API secret, plus a model key. None were read or written
- Security: no new scan was run. A live agent can join a room and speak. That was not started
- Integration: Adrian Mind does not import `@livekit/agents`. Adding it would be a new voice path, not an upgrade of Speak
- Compatibility: a Vite preview was not tested against this package
- Risks: cloud rooms and model calls can send audio outside this preview. Do not treat the plugin release as the SDK
- Rollback: do not add the package. Nothing was installed
- Maintenance: LiveKit publishes the repository. Support beyond the public repo is unverified
