# Feature completion matrix

States match the product rule: Verified, Implemented with limitations, Blocked, Deferred.

| ID | Feature | State | Evidence |
|---|---|---|---|
| NAV | Multi-surface navigation | Implemented with limitations | New views render real controls. A signed-in click-through was not part of smoke. |
| WORKER | Local agent worker | Verified | `fleet.test.ts` local read, pause, cancel, lease, delegation. |
| HOST | Hosted worker | Blocked | `mind-worker.mjs` exits 2 without `DATABASE_URL`. |
| PLAN | Bounded Grok planner | Implemented with limitations | Fake-model tests. Live tool call not spent. |
| CHAT | Grok chat | Implemented with limitations | Existing adapter. Live send not spent in this change. |
| SEARCH | Web research | Blocked | No search endpoint or key. Mock citation filter remains verified. |
| GMAIL | Multiple mailboxes | Blocked | 60 records stay `not_connected`. OAuth is absent. Send asks, then refuses. |
| BROWSER | Page driver | Implemented with limitations | Headless Chromium opened a local HTML document. Product button not clicked on a public site. |
| SCHED | Due schedules | Verified | `runDueSchedules` queues one run. No hosted cron. |
| CONN | Provider connection records | Verified | Secrets are not stored. Unconfigured providers stay unselected. |
| MEDIA | Image and video | Blocked | Paid APIs are not called. |
| VOICE | Full duplex | Blocked | One-shot Speak only. |
| REA | Healthy REA | Blocked | Doctor JSON healthy false. Node 22.23.3. Native engines missing. |
| DB | Durable database | Blocked | `DATABASE_URL` unset. |
| PHONE | iPhone install | Blocked | No physical device. |
| PC | HP EliteBook | Blocked | No pairing protocol was completed. |
| ZAPIA | Zapia | Deferred | Screenshot observed. Not built. |
