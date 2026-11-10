import type { PublicAiProvider } from "../ai-provider-config.server.ts";

export type ProbeCheck = "passed" | "failed" | "not_run";
export type ProviderReadiness = "VERIFIED" | "PARTIAL" | "BLOCKED" | "NOT_AUDITED";

export type KimiProviderChecks = {
  auth: ProbeCheck;
  streaming: ProbeCheck;
  toolCalls: ProbeCheck;
  cancellation: ProbeCheck;
  usage: ProbeCheck;
};

/** Server-owned evidence only. Never accept this evidence as client-authored UI input. */
export type KimiProviderEvidence = {
  runtime: string;
  runtimeVersion: string;
  providerId: string;
  model: string;
  checkedAt: number;
  checks: KimiProviderChecks;
};

export type KimiModelOption = {
  model: string;
  readiness: ProviderReadiness;
  checks: KimiProviderChecks | null;
  runtimeVersion?: string;
  checkedAt?: number;
  reason: string;
};

export type KimiProviderOption = {
  providerId: string;
  label: string;
  hasCredential: boolean;
  defaultModel: string;
  models: KimiModelOption[];
};

export type KimiProviderSelection = { providerId: string; model: string };

const REQUIRED_CHECKS: (keyof KimiProviderChecks)[] = ["auth", "streaming", "toolCalls", "cancellation", "usage"];

function isValidCheck(value: unknown): value is ProbeCheck {
  return value === "passed" || value === "failed" || value === "not_run";
}

function sanitizedEvidence(evidence: KimiProviderEvidence): KimiProviderChecks | null {
  if (evidence.runtime !== "kimi-acp" || !evidence.runtimeVersion.trim()) return null;
  const checks = evidence.checks;
  if (!checks || !REQUIRED_CHECKS.every((key) => isValidCheck(checks[key]))) return null;
  return { ...checks };
}

function latestEvidence(
  evidence: readonly KimiProviderEvidence[],
  providerId: string,
  model: string,
): KimiProviderEvidence | undefined {
  return evidence
    .filter((item) => item.providerId === providerId && item.model === model && item.runtime === "kimi-acp" &&
      typeof item.runtimeVersion === "string" && item.runtimeVersion.trim().length > 0 &&
      Number.isFinite(item.checkedAt))
    .sort((a, b) => b.checkedAt - a.checkedAt)[0];
}

function readinessFor(checks: KimiProviderChecks): { readiness: ProviderReadiness; reason: string } {
  const states = REQUIRED_CHECKS.map((key) => checks[key]);
  if (states.includes("failed")) return { readiness: "BLOCKED", reason: "A required provider check failed for this Kimi runtime/model." };
  if (states.every((state) => state === "passed")) return { readiness: "VERIFIED", reason: "All required provider checks passed on the recorded Kimi runtime." };
  if (states.some((state) => state === "passed")) return { readiness: "PARTIAL", reason: "Some required provider checks have not passed." };
  return { readiness: "NOT_AUDITED", reason: "No required provider checks have passed." };
}

/**
 * Create a secret-free model catalog. A provider configured for Adrian OS is
 * not assumed to work inside Kimi ACP; each exact provider/model pair must have
 * matching server-owned evidence from the installed Kimi runtime.
 */
export function buildKimiProviderCatalog(
  providers: readonly PublicAiProvider[],
  evidence: readonly KimiProviderEvidence[],
): KimiProviderOption[] {
  return providers.slice(0, 100).map((provider) => {
    const models = [...new Set(provider.models.filter((model) => typeof model === "string" && model.length > 0))].slice(0, 120);
    return {
      providerId: provider.id,
      label: provider.label,
      hasCredential: provider.hasKey === true,
      defaultModel: provider.defaultModel,
      models: models.map((model) => {
        if (provider.hasKey !== true) {
          return { model, readiness: "BLOCKED", checks: null, reason: "No saved provider credential." };
        }
        const tested = latestEvidence(evidence, provider.id, model);
        const checks = tested ? sanitizedEvidence(tested) : null;
        if (!tested || !checks) {
          return { model, readiness: "NOT_AUDITED", checks: null, reason: "This provider/model has not been verified with Kimi ACP." };
        }
        const { readiness, reason } = readinessFor(checks);
        return {
          model,
          readiness,
          checks,
          runtimeVersion: tested.runtimeVersion.slice(0, 80),
          checkedAt: tested.checkedAt,
          reason,
        };
      }),
    };
  });
}

/** Select only the exact provider/model explicitly chosen and fully verified; never fall back. */
export function selectVerifiedKimiProvider(
  catalog: readonly KimiProviderOption[],
  selection: KimiProviderSelection,
): { ok: true; selection: KimiProviderSelection } | { ok: false; error: string } {
  const provider = catalog.find((item) => item.providerId === selection.providerId);
  if (!provider) return { ok: false, error: "The selected provider is not available for this account." };
  if (!provider.hasCredential) return { ok: false, error: "The selected provider has no saved credential." };
  const model = provider.models.find((item) => item.model === selection.model);
  if (!model) return { ok: false, error: "The selected model is not in the saved provider catalogue." };
  if (model.readiness !== "VERIFIED") return { ok: false, error: model.reason };
  return { ok: true, selection: { providerId: provider.providerId, model: model.model } };
}
