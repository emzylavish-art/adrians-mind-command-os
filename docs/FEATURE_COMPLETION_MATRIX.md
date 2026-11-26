# Feature completion evidence

Completion belongs to an exact revision and an observed environment. The current machine-readable inventory is [feature-evidence.json](verification/feature-evidence.json). It covers every row from the earlier matrix and preserves four product states: **verified**, **implemented with limitations**, **blocked**, and **deferred**. Verification is separate: passed, failed, skipped, canceled, or unverified.

The candidate was developed from `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. This implementation inventory deliberately has no invented verification SHA. Uncommitted fixtures, source inspection, or an older production deployment cannot establish a newly committed candidate's live behavior. The implementation handoff records targeted test results separately. Populate verification after checks run against the final exact candidate.

The earlier table is retained as [historical evidence](verification/feature-matrix-legacy.md). Its unversioned claims that OAuth, a pairing protocol, or realtime voice were absent are not current feature descriptions. The source contains implementations; their presence alone does not prove a live account, runtime, or device.

## Validate a record

```bash
node scripts/verification/validate.mjs --features docs/verification/feature-evidence.json --revision FULL_CANDIDATE_SHA
```

This consistency check accepts explicit unverified records. Add `--require-current` when every listed feature must have passed evidence for the candidate. Prior passed evidence becomes **historical** when its revision differs. A valid record is not a substitute for opening its artifacts or independently checking a service.

Each passed verification needs the exact revision, environment, execution time, supporting artifact links, and remaining blockers. Physical evidence additionally needs an actual device and runtime version; signed-in evidence must state authentication explicitly. A failed, skipped, canceled, or unverified check is never promoted to passed.

## Remaining environment checks

See [environment-evidence.json](verification/environment-evidence.json) and the [verification guide](verification/README.md). Physical iPhone, Windows installer, paired runtime, Android, authenticated production, and live-provider checks remain separate from website source and fixtures. No device or production result is asserted by this document.
