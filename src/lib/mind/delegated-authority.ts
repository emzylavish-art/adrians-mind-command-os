export type AuthorityGrant = {
  id: string;
  holder: string;
  scopes: string[];
  expiresAt: number;
  revoked: boolean;
  parentId: string | null;
  canDelegate: boolean;
};

export function issueGrant(input: {
  id: string;
  holder: string;
  scopes: string[];
  expiresAt: number;
  canDelegate?: boolean;
}): AuthorityGrant {
  return {
    id: input.id,
    holder: input.holder,
    scopes: [...new Set(input.scopes)],
    expiresAt: input.expiresAt,
    revoked: false,
    parentId: null,
    canDelegate: input.canDelegate === true,
  };
}

export function delegateGrant(parent: AuthorityGrant, child: Omit<AuthorityGrant, "parentId" | "revoked">, now: number): AuthorityGrant {
  if (parent.revoked || parent.expiresAt <= now || !parent.canDelegate) {
    throw new Error("Parent cannot delegate.");
  }
  if (child.holder === parent.holder) throw new Error("A holder cannot expand its own grant.");
  if (child.expiresAt > parent.expiresAt) throw new Error("A child grant cannot outlive its parent.");
  if (child.scopes.some((scope) => !parent.scopes.includes(scope))) {
    throw new Error("A child grant cannot widen its parent.");
  }
  return { ...child, scopes: [...new Set(child.scopes)], revoked: false, parentId: parent.id, canDelegate: false };
}

export function revokeGrant(grant: AuthorityGrant): AuthorityGrant {
  grant.revoked = true;
  return grant;
}

export function useGrant(grant: AuthorityGrant, scope: string, now: number): { ok: boolean; reason: string } {
  if (grant.revoked) return { ok: false, reason: "revoked" };
  if (grant.expiresAt <= now) return { ok: false, reason: "expired" };
  if (!grant.scopes.includes(scope)) return { ok: false, reason: "scope" };
  return { ok: true, reason: "in force" };
}

export const IDENTITY_NETWORK = "not connected" as const;
