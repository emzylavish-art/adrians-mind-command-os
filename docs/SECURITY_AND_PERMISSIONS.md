# Security and permissions

Existing controls stay in place.

- Unsigned mind calls still require the owner, except status.
- Emergency stop cancels an in-flight chat reply, the bounded planner, and non-terminal worker runs.
- Delete and replace still ask. `gmail_send` and `browser` use the protected `publish` class, so automatic mode does not approve them.
- Connection records cannot store a secret. `readFleet` forces `secretStored` false.
- Mailbox status is forced to `not_connected`.
- Page opens reject credential URLs and non-http URLs.
- The hosted worker refuses the two forbidden database references and does not poll.
- Owner isolation for snapshots is unchanged. Fleet rows in the migration are keyed by `user_id`.
- Cancellation still does not guarantee a zero model charge. The new worker avoids that question by not calling a model.

The frontend is not the authority. The worker re-checks halt, approval, and tool kind on each tick.
