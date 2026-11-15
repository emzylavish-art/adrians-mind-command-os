# Langfuse

Classification: evaluation-only. Not installed. Not callable.

- Official repository: https://github.com/langfuse/langfuse
- Server release checked: v4.80.0, published 2026-11-13
- Client package checked: npm `langfuse` 3.39.2, MIT, Node `>=18`, unpacked 714,407 bytes, depends on `langfuse-core`
- License: the repository license API says NOASSERTION. The v4.80.0 LICENSE file says core content is MIT, copyright 2023-2026 ClickHouse, Inc., and that `ee/` is excluded
- Enterprise: `ee/LICENSE` at v4.80.0 is a separate Langfuse Enterprise license, also copyright ClickHouse, Inc. It is not MIT. It was not accepted
- Activity: public, not archived. At check: 37,444 stars, 4,234 forks, 1,167 open issues including pull requests, pushed 2026-11-14
- Runtime: self-host is a server, not a drop-in for the Vite preview. The npm package is a tracing client
- Install size: the server was not measured. Docker images were not pulled
- Commercial: core may be used under MIT. Enterprise features and Langfuse Cloud are separate. No account was created and no money was spent
- Secrets: a client needs a project public key and secret key. None were read or written
- Security: no new scan was run. Tracing can send prompts and outputs to a host outside this preview
- Integration: Adrian Mind does not import `langfuse`. A listed client is not a connected trace pipeline
- Compatibility: whether the 3.39.2 client can send traces to the v4.80.0 server was not tested
- Risks: do not enable enterprise modules. Do not send workspace notes to a Langfuse host without a later owner approval
- Rollback: do not add the package or start Compose. Nothing was installed
- Maintenance: the repository is published by the Langfuse project, now noted under ClickHouse in the license header. Support beyond that file is unverified
