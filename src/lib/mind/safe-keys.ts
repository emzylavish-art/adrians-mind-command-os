/** Server credentials are deliberately not exposed in the browser settings UI. */
export const SAFE_KEY_PROVIDERS = [
  { id: "grok", name: "Grok", environment: "XAI_API_KEY" },
  { id: "openai", name: "OpenAI", environment: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic", environment: "ANTHROPIC_API_KEY" },
  { id: "gemini", name: "Gemini", environment: "GEMINI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", environment: "OPENROUTER_API_KEY" },
  { id: "notion", name: "Notion", environment: "NOTION_TOKEN / NOTION_API_KEY" },
] as const;
