import { AGENT_TEMPLATES, type AgentDefinition, type DeploymentRecord, type FleetShape } from "../fleet.ts";
import { PERSONA_CATEGORIES, categoryForRole, type PersonaCategoryId } from "./categories.ts";

export type PersonaSource = "template" | "saved";

export type PersonaCard = {
  id: string;
  name: string;
  description: string;
  role: string;
  /** Primary shelf: templates → official, saves → mine. Role categories use roleCategory. */
  category: "official" | "mine";
  roleCategory: PersonaCategoryId;
  source: PersonaSource;
  templateName?: string;
  templateId?: string;
  agentId?: string;
  tools: string[];
  live: false;
  badge: "TEMPLATE" | "SAVED";
  statusLabel: string;
};

export type PersonaDirectory = {
  categories: typeof PERSONA_CATEGORIES;
  cards: PersonaCard[];
  counts: Record<PersonaCategoryId, number>;
};

export type PersonaFilter = {
  category?: PersonaCategoryId | "all";
  query?: string;
};

function statusForSaved(agent: AgentDefinition, deployments: DeploymentRecord[]): string {
  if (agent.archived) return "Archived";
  const deployment = deployments.find((item) => item.agentId === agent.id);
  if (!deployment) return "Saved · not deployed";
  if (deployment.state === "local-ready") return "Local ready";
  return `External required${deployment.error ? ` · ${deployment.error}` : ""}`;
}

function templateCards(): PersonaCard[] {
  return AGENT_TEMPLATES.map((template) => {
    const roleCategory = categoryForRole(template.role);
    return {
      id: `template:${template.templateId}`,
      name: template.name,
      description: template.description,
      role: template.role,
      category: "official" as const,
      roleCategory,
      source: "template" as const,
      templateName: template.name,
      templateId: template.templateId,
      tools: [...template.tools],
      live: false as const,
      badge: "TEMPLATE" as const,
      statusLabel: "Template · add to My agents to run",
    };
  });
}

function savedCards(agents: AgentDefinition[], deployments: DeploymentRecord[]): PersonaCard[] {
  return agents
    .filter((agent) => !agent.archived)
    .map((agent) => ({
      id: `saved:${agent.id}`,
      name: agent.name,
      description: agent.description,
      role: agent.role,
      category: "mine" as const,
      roleCategory: categoryForRole(agent.role),
      source: "saved" as const,
      agentId: agent.id,
      tools: [...agent.tools],
      live: false as const,
      badge: "SAVED" as const,
      statusLabel: statusForSaved(agent, deployments),
    }));
}

function emptyCounts(): Record<PersonaCategoryId, number> {
  return Object.fromEntries(PERSONA_CATEGORIES.map((item) => [item.id, 0])) as Record<PersonaCategoryId, number>;
}

/** Build Explore cards from real local fleet state + built-in templates. Never invents live remote bots. */
export function buildPersonaDirectory(fleet: Pick<FleetShape, "agents" | "deployments">): PersonaDirectory {
  const cards = [...templateCards(), ...savedCards(fleet.agents, fleet.deployments)];
  const counts = emptyCounts();
  for (const card of cards) {
    counts[card.category] += 1;
    if (card.roleCategory !== card.category) counts[card.roleCategory] += 1;
  }
  return { categories: PERSONA_CATEGORIES, cards, counts };
}

function matchesCategory(card: PersonaCard, category: PersonaCategoryId | "all"): boolean {
  if (category === "all") return true;
  if (category === "official") return card.category === "official";
  if (category === "mine") return card.category === "mine";
  return card.roleCategory === category;
}

export function filterPersonaDirectory(directory: PersonaDirectory, filter: PersonaFilter = {}): PersonaCard[] {
  const category = filter.category ?? "all";
  const query = (filter.query ?? "").trim().toLowerCase();
  return directory.cards.filter((card) => {
    if (!matchesCategory(card, category)) return false;
    if (!query) return true;
    const blob = `${card.name} ${card.description} ${card.role} ${card.tools.join(" ")}`.toLowerCase();
    return blob.includes(query);
  });
}

export function emptyStateForCategory(category: PersonaCategoryId | "all", visibleCount: number): string | null {
  if (visibleCount > 0) return null;
  if (category === "all") {
    return "No personas match. Add a template under Official, or save an agent on Bots & Agents. Explore never lists remote Poe or Character.AI bots as live.";
  }
  const meta = PERSONA_CATEGORIES.find((item) => item.id === category);
  return meta
    ? `No local personas in ${meta.label}. ${meta.description}`
    : "No local personas in this category.";
}
