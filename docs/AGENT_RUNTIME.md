# Agent runtime

## Definitions

Ten templates live in `AGENT_TEMPLATES`. Adding one copies it onto the device. Archive hides it. Editing the tool list is how a test forces a single step such as `gmail_send` or `model`.

Each run has a state: queued, running, waiting_approval, waiting_external, paused, completed, failed, or canceled.

## Step rules

- `list_projects`, `list_chats`, and `search_notes` use the existing local lookup.
- `web_search` uses only a search function the caller supplies. The Runs button does not supply one, so the run waits and stores no citations.
- `browser` is a protected publish action. Without approval, nothing opens. Without a driver, the event says no page was opened.
- `gmail_read` and `gmail_send` never touch Google. A send asks first, then reports that no mailbox is connected.
- `model` does not call a provider.
- `delegate` creates at most two child runs, one level deep. Children do not delegate again.

Emergency stop cancels non-terminal runs. A lease held by another worker is not stolen. Four runs are processed per tick.

## What this is not

It is not a durable queue, a hosted process, or a multi-agent swarm with a model in the loop. Run worker once is the local execution path.
