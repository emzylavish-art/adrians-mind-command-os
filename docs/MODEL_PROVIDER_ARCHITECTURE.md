# Model provider architecture

The repository model router supports explicit Astra, Sol, Luna, Grok, OpenRouter,
and Ollama routes. The `auto` route attempts Astra, then Sol, then Luna and
records the actual successful provider. Astra/Sol/Luna require endpoint, model,
and key bindings; no model identifier or endpoint is guessed from a label.

Connected apps can store extra connection labels. `secretStored` is always false. Keys typed into the browser are not accepted. A Grok label is not marked server-configured by the form, so the record cannot pretend the live key was verified.

Ollama remains an explicit local route. No local model server was detected or
called during onboarding.

The bounded planner remains a separate Grok path on the Agents screen. The new worker refuses the `model` tool so a queue tick cannot spend a credit.
