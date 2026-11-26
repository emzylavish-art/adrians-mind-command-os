# Feature completion evidence

Completion belongs to an exact revision and an observed environment. The current machine-readable inventory is [feature-evidence.json](verification/feature-evidence.json). It covers every row from the earlier matrix and preserves four product states: **verified**, **implemented with limitations**, **blocked**, and **deferred**. Verification is separate: passed, failed, skipped, canceled, or unverified.

The C1 implementation was tested at **`b17e90c5728f7f1a9f303f703fcf073cbdd2175e`**, based on `18d5b9364e6bdcfec028eeccf56fe596946ed8ce`. Its [scoped feature results](audits/evidence/c1-feature-evidence.json), [environment results](audits/evidence/c1-environment-evidence.json), and [validation record](audits/c1-validation.json) retain actual local evidence:416 passing regression files,2,295 passing tests,4 explicit optional skips,14 synthetic browser states and 11 workflow transitions. The full-product inventory remains a conservative template. These local results do not establish live account/provider/deployment or physical-device behavior.

The earlier table is retained as [historical evidence](verification/feature-matrix-legacy.md). Its unversioned claims that OAuth, a pairing protocol, or realtime voice were absent are not current feature descriptions. The source contains implementations; their presence alone does not prove a live account, runtime, or device.

## Validate a record

```bash
node scripts/verification/validate.mjs --features docs/verification/feature-evidence.json --revision FULL_CANDIDATE_SHA
```

This consistency check accepts explicit unverified records. Add `--require-current` when every listed feature must have passed evidence for the candidate. Prior passed evidence becomes **historical** when its revision differs. A valid record is not a substitute for opening its artifacts or independently checking a service.

Each passed verification needs the exact revision, environment, execution time, supporting artifact links, and remaining blockers. Physical evidence additionally needs an actual device and runtime version; signed-in evidence must state authentication explicitly. A failed, skipped, canceled, or unverified check is never promoted to passed.

## Remaining environment checks

See [environment-evidence.json](verification/environment-evidence.json) and the [verification guide](verification/README.md). Physical iPhone, Windows installer, paired runtime, Android, authenticated production, and live-provider checks remain separate from website source and fixtures. No device or production result is asserted by this document.
