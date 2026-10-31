# Agent deployment

## Local

Arm local worker writes a deployment record with state `local-ready` and worker id `browser-worker`. That means the Runs screen can call `tickFleet`. It does not start a background operating-system service.

## Hosted

Record hosted target writes state `external-required` and the error "No hosted worker is provisioned. This record does not start a remote process."

`scripts/mind-worker.mjs` is the process entry. If `DATABASE_URL` is missing, or the URL contains a forbidden project reference, it exits without polling and without printing a success. A real poller is not implemented, because there is no dedicated database to lease from.

Saving an agent or arming the local button is not a remote deployment.
