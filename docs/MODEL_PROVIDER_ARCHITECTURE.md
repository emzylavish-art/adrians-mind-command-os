# Model provider architecture

Chat still resolves through `chosenProvider`. Only Grok can be enabled, and only when the server key is present. GPT, Claude, Gemini, and OpenRouter stay disabled. A stored choice other than `grok` is ignored. Nothing is substituted.

Connected apps can store extra connection labels. `secretStored` is always false. Keys typed into the browser are not accepted. A Grok label is not marked server-configured by the form, so the record cannot pretend the live key was verified.

Ollama is a connection label only. No local model server was detected or called.

The bounded planner remains a separate Grok path on the Agents screen. The new worker refuses the `model` tool so a queue tick cannot spend a credit.
