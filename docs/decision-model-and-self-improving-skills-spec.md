# Technical Specification
## Decision Model Router + Self-Improving Skill System
**For Astra & ZAPI / Personal AI OS**

**Version:** 1.0  
**Date:** 2026-11-05  
**Owner:** Adrian  
**Implementers:** Astra, ZAPI/Zapia  

---

### 1. Purpose
Add two capabilities to the existing Personal AI Operating System:

1. **Decision Model Router** — Use fast, cheap decision models (Jev, Clef, etc.) to classify and route requests before full agents run.
2. **Self-Improving Skill System** — Let agents create, update, and refine markdown skills after successful work (Hermes-style), with a background Curator to keep the library clean.

These two systems work together so the OS becomes more personalized and efficient over time.

---

### 2. Scope

**In scope**
- Decision router for incoming requests
- Skill creation and update after agent runs
- Simple Curator (usage tracking + archival)
- Logging of decisions and skill usage
- Integration points with existing Astra / ZAPI flows and Notion

**Out of scope (for v1)**
- Full local model hosting of large decision models
- Automatic fine-tuning
- Complex multi-agent negotiation
- Production-grade security hardening of the skill store

---

### 3. Decision Model Router

#### 3.1 Responsibilities
- Receive a user request or agent context
- Call a decision model with a short structured prompt
- Return a classification + confidence
- Route to the appropriate skill or agent based on the result

#### 3.2 Supported Decision Models (priority order)
1. Jev (TypeSafe API) — primary for speed and cost
2. Clef-flash (Cloudflare) — open-weight fallback
3. Clef or other “Bob”-style models later

#### 3.3 Router Input Format
```json
{
  "request_text": "string",
  "context_summary": "string (optional, max 500 tokens)",
  "available_routes": ["cybersecurity_learning", "business_outreach", "content", "research", "admin", "other"],
  "user_goals": ["string"]
}
```

#### 3.4 Router Output Format
```json
{
  "selected_route": "cybersecurity_learning",
  "confidence": 0.87,
  "reasoning": "short text",
  "suggested_skills": ["linux_basics", "network_recon"]
}
```

#### 3.5 Routing Rules (v1)
- Confidence ≥ 0.75 → auto-route
- Confidence 0.5–0.74 → route but flag for review
- Confidence < 0.5 → fall back to default agent or ask user

#### 3.6 Logging
Every decision is written to a Notion database or log with:
- Timestamp
- Request summary
- Model used
- Selected route
- Confidence
- Outcome (success / user correction)

---

### 4. Self-Improving Skill System

#### 4.1 Skill Storage
- Primary: Notion database called **Skills**
- Secondary: Local markdown files (for agents that need fast file access)
- Schema:

| Field              | Type     | Notes                          |
|--------------------|----------|--------------------------------|
| Name               | Title    | Unique                         |
| Description        | Text     | When to use                    |
| Steps              | Rich text| Numbered procedure             |
| Domain             | Select   | cybersecurity, business, etc.  |
| Created by         | Select   | agent / user                   |
| Use count          | Number   | Incremented on use             |
| Last used          | Date     |                                |
| Status             | Select   | active / stale / archived      |
| Related skills     | Relation |                                |

#### 4.2 Skill Creation Trigger
After an agent completes a task successfully:
1. Agent receives a reflection prompt.
2. It decides if the workflow is reusable.
3. If yes, it creates or updates a skill draft.
4. Draft is saved with status “draft” until reviewed or auto-approved.

#### 4.3 Reflection Prompt (for agents)
```
You just completed the following task successfully:
[task summary]

Did this involve a reusable workflow?
If yes, write a skill in this format:
- Name:
- When to use:
- Steps:
- Edge cases:
- Domain:
```

#### 4.4 Curator Job (background)
Runs weekly (or on demand):
- Mark skills unused for 30+ days as “stale”
- Archive skills unused for 60+ days
- Flag skills with high similarity for possible merge
- Write a short report to Notion

---

### 5. Integration Points

**Astra**
- Owns the Decision Router service
- Calls decision model before major agent handoffs
- Writes skill drafts to the Skills database

**ZAPI / Zapia**
- Executes the selected skill or agent
- Increments skill use count
- Triggers reflection after successful runs

**Notion**
- Skills database
- Decision log database
- Curator reports page

---

### 6. Implementation Order

| Phase | Task                                      | Owner   | Priority |
|-------|-------------------------------------------|---------|----------|
| 1     | Create Skills database in Notion          | Astra   | High     |
| 2     | Build Decision Router function            | Astra   | High     |
| 3     | Add reflection step after agent runs      | ZAPI    | High     |
| 4     | Log decisions and skill usage             | Both    | Medium   |
| 5     | Simple Curator job                        | Astra   | Medium   |
| 6     | Test end-to-end on cybersecurity domain   | Both    | High     |

---

### 7. Success Criteria (v1)
- Decision router correctly classifies ≥ 80% of test requests
- At least 10 skills are created by agents and used more than once
- Average cost per routed request is lower than full-agent runs
- User reports the system feels more consistent on repeated tasks

---

### 8. Open Questions
- Preferred first decision model (Jev API key available?)
- Should skill drafts require manual approval in v1?
- Where should the Curator report be stored?

---

*This spec is ready to hand to Astra and ZAPI.*
