# Implementation architecture

The app remains the existing TanStack Start workspace. New behavior sits beside chat, it does not replace it.

## Surfaces

The left navigation opens Command, Chat, Agents, Runs, Projects, Research, Library, Connected, Tools, Scheduled, Memory, Activity, and Settings. Integrations remains reachable from Command. Chat still uses the existing Grok path.

## State

`Workspace` now also stores agents, deployments, runs, run events, connections, mailboxes, schedules, pins, and browser sessions. Old snapshots still load. Missing arrays become empty. The browser copy is the source of truth until a dedicated database URL is set. The snapshot JSON includes these fields when it is saved.

`migrations/0003_fleet.sql` creates owner-scoped tables for a future database. The running server still reads the snapshot payload. With `DATABASE_URL` unset, nothing is durable across a process restart.

## Worker

`tickFleet` in `src/lib/mind/fleet.ts` is a pure function. The Runs screen calls it when the owner presses Run worker once. It executes at most four runs per call, takes a 30 second lease, and writes events.

Local tools call the existing `runLocalPlan`. Web search, Gmail, browser, and model steps do not invent results. Search and browser run only when a caller passes a real function. The default search path reports that no provider is configured. The model step never calls xAI.

## What is intentionally not a second chat engine

Provider connections are labels and status. Chat routing still goes through `chosenProvider`. Another provider is not substituted.
