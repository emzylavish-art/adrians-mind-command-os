# Visual walk — pass 2026-11-07at

Password audit login: **not attempted** (REA_AUDIT_EMAIL still `@example.com` placeholder).

## URLs / views
| View | Result |
|---|---|
| /dashboard | Loader “Painting the universe…” (01); unsigned curl still 307→login |
| / (home/Command) | Renders Command chrome (02): Ask/Automatic, Memory OFF, composer, ⌘K, Speak |
| /memory | Empty (03) |
| /explore | Persona directory; cards TEMPLATE / NOT LIVE (04) |
| Library / Projects | Reachable via sidebar (05–06); local/empty |
| Scheduled | “No worker process is running…”; local-only DB; no schedules (07) |
| Settings | Workspace nav grid; Appearance; “Grok configured” in header (08) |
| Tools (in-app) | Tools panel with availability grid; MCP servers “Loading…”; Web search Not available (09). Deep `/tools` still 404 via curl |

## Broken / missing (known unless noted)
- Recent Activity still lists `forbidden_cross_site` (02)
- Header: Checking → **Grok configured** while Safe Keys path historically NOT CONNECTED (honesty routed 07e; Settings shows configured this pass)
- Toast: “Sign in to use voice and connected services”
- Universe paint: loader captured at start (01); prior passes often paint after — intermittent (07c)
- Sidebar items still buttons; curl deep-links `/chat` `/activity` `/tools` `/voice` 404
- Explore handoff “not yet verified”; most personas NOT LIVE

## Screenshots
01-dashboard-painting.png … 09-tools.png under this directory.
