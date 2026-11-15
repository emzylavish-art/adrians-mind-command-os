# Scheduled buttons

Checked the live preview at `http://127.0.0.1:8080/` on 2026-11-12. Surface is the Scheduled panel only (`section.page-shell` whose heading is Scheduled, `data-view="scheduled"`). Viewports: 1280×800 and 390×844. Signed out. Isolated browser storage, so this did not change the preview’s saved workspace.

On desktop the rail is already open; Scheduled is a rail control outside this surface. On the phone the rail is hidden until Open menu; that opener is also outside this surface. After the view opens, the same panel controls are on screen. The panel scrolls inside `.min-h-0.flex-1.overflow-auto`, not the document.

Empty state shows three controls. A saved job adds Turn off. A failed add adds Retry below the fold. Worker health was ready (“No worker process is running. Schedules stay saved. Nothing is running in the background.”), so that row rendered no button.

## Working

| Control | Where | What a click does |
| --- | --- | --- |
| Worker command | Both. `<summary>`, not a `<button>` | Toggles the details. Open shows the local tick/worker command lines and `MIND_WORKER_INTERVAL_MS`. It does not start a worker. Pointer hit the summary on both viewports. |
| Add daily job | Both | Saves a local daily job in this browser when Name is non-blank. Attaches the current agent id if one exists, interval 1440 minutes, time zone from the field or UTC, minute 0. Blank or whitespace Name does not save; it shows “Name the schedule.” Hour `99` is clamped to 23 and still saves. Empty Hour saves an interval job (every 1440 minutes) whose next time is now. |
| Run due schedules | Both | Runs due enabled jobs in local workspace state. A future clock job (07:00 Chicago) did not change. An interval job already due updated last run and set the error “That agent is not on this device. Nothing was queued.” It does not start the worker process. |
| Turn off | Both, one per saved job | Sets that job to Off. Label becomes Turn on. Next time is unchanged. |
| Turn on | Both, after Turn off | Sets that job back to On. Label becomes Turn off. |
| Retry | Both, only after a failed add (`data-testid="failure-retry"`) | Re-runs the same failed add. With a blank name the banner stays “Name the schedule.” A second click does the same. It is below the fold until the panel is scrolled; after scroll the pointer hits Retry on both viewports, not the sign-in banner. |

## Dead (pointer does nothing)

None on this surface. Every control that was rendered had a handler, and a real pointer hit the control rather than a covering layer.

## Not on screen

These exist in the panel code and were not rendered during this check:

- Worker-health Retry, and View log. The probe succeeded, so `WorkerHealthStatusRows` returned nothing. A failed probe would show Retry and re-check worker health. View log is not passed in, so that button is not rendered even on error.
- Auth Dismiss. Shown only if the worker-health load is `auth_required`. It was not.
- Mutation View log. The add-failure banner renders Retry only. `onViewLog` is not passed.
- Turn off / Turn on. Absent until at least one job is saved. Confirmed after Add daily job.

Shell controls visible beside the panel (Notion “could not be read” Retry, View log, Dismiss, header, Sign in, Speak, rail) are not part of this surface. None of them covered the panel controls that were in view.
