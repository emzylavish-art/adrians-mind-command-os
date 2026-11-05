# PROVIDER ROUTER

Wires the GPT API key and XAI/Grok key into the provider router. Implements runtime brain switch: when Adrian changes the active model, every bot switches on the next call without restart. Spawns sub-agents to verify the switch reached every lane. Reads BOOT.md first.