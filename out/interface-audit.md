# Adrian's Mind — UI action audit

Generated: 2026-11-19T20:18:32.675Z

Static evidence only. Browser and backend end-to-end verification remains required.

## Summary

- Files scanned: 86
- Controls inventoried: 646
- change-wired: 118
- handler-wired: 486
- navigation-wired: 17
- submit-wired: 23
- unwired: 2

## Controls requiring review

| File | Line | Element | Status | Label |
|---|---:|---|---|---|
| src/components/mind/build-workspace.tsx | 639 | input | unwired | {`Rename session ${session.name}`} |
| src/components/mind/owner-flow.tsx | 128 | button | unwired | Run |

## Test policy

For each control, verify frontend action, authorization, backend operation,
provider/worker result, persistence, and honest error/success feedback.
