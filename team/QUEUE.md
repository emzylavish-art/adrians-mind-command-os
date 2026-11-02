# Durable Worker Queue

SQLite-backed persistent task queue for local Mind Command OS worker processes.

## CLI

```bash
python team/queue.py enqueue --task "inspect repository" --payload '{"capabilities":["source_inventory"]}'
python team/queue.py claim --worker worker-01 --lease-seconds 120
python team/queue.py list --status queued
python team/queue.py complete --id JOB_ID --worker worker-01 --result '{"status":"done"}'
python team/queue.py fail --id JOB_ID --worker worker-01 --error "temporary failure"
```

The queue persists job state, tracks attempts, and supports lease expiry/reclaim.
A job's payload is data only: the queue never executes it. Worker code must validate
the payload, select permitted tools, and honor approval requirements. Completion and
failure require the worker ID currently holding the claim.

The default database is `team/queue.sqlite3` and is ignored by Git. Use `--db` to
select another local database. This provides durable local queue state, not a hosted
multi-machine worker service or a guarantee that any worker is running.


## Allowlisted worker

Run one queued tool job:

```bash
python team/worker.py --worker-id worker-01 --once
```

Run a polling worker (stops after 20 completed/failed jobs):

```bash
python team/worker.py --worker-id worker-01 --max-jobs 20
```

Payloads must name an allowlisted tool such as `team.health`, `rea.scan`,
`security.scan`, or `knowledge.search`. The worker rejects arbitrary tool IDs
and never executes shell/code from job data. A polling worker is an explicitly
launched process; it is not automatically hosted as an OS service.
