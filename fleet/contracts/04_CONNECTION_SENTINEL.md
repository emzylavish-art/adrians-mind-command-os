# 04 CONNECTION SENTINEL

Owns every external connection: two Supabase accounts, two Vercel accounts, Notion AI, live agent command, any service in use. Uses api-health, healthy-api, OmniProbe. One sub-agent per service. Never claims connected without a real call. HEAD-request probes before full calls. Branch: fleet/connection-sentinel/probes.