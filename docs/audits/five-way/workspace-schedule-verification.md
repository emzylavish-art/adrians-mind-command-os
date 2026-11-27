# Combined workspace and schedule checkpoint

All checks below used the combined website worktree and synthetic data. They exercised no hosted scheduler, external delivery, authenticated provider or physical device.

| Source | Integrated behavior | Local regression evidence |
| --- | --- | --- |
| C1 AA-013/065 | Large first sync retains the document text limit, splits bounded deltas and resumes from the last confirmed batch. | workspace-reconciliation.test.ts |
| C1 AA-075–081 | Persist document identity, retrieval exclusion, original and PDF provenance. The owner and workspace policy are checked again before provider dispatch. | knowledge.test.ts, document-originals.test.ts |
| C1/C3 Library | Keep both existing owner-scoped original stores readable, preserve file versions and checksums, and keep the separate Library preview bound. | library-documents.test.ts, document-originals.test.ts |
| C2 AA-028/051/136 and C4 attachment manifest | Restore file tombstones, calculate archive manifests after temporary records are excluded, and prevent an imported schedule from authorizing conversation delivery. | workspace-archive-manifest.test.ts |
| C2 AA-026–028 and C3 schedule recovery | Persist each occurrence and its original chat, reconcile completed work, and expose the result destination in the schedule UI. A replacement chat cannot receive a queued result. | C2 scheduled occurrences in fleet-audit-recovery.test.ts; schedule-policy.test.ts |

The six workspace, archive, Library, original, knowledge and schedule-policy suites passed 39 tests. The separately selected C2 scheduled-occurrence suite passed eight tests, including the cross-branch destination-change case. The broader fleet execution suite and combined release gates remain open. These results do not establish that the website is ready for promotion.
