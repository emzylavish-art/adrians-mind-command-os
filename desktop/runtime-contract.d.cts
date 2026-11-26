export type RuntimeIdentity = { build: number; version: string; revision: string | null; deviceId: string; artifactId: string; dirty: boolean };
export type RuntimeReceipt = RuntimeIdentity & { product: string; storage: string; essentialRoutes: string; proof: string };
export function readinessReceipt(identity: RuntimeIdentity, challenge: string, secret: string, storage: boolean): RuntimeReceipt;
export function validateReadiness(value: unknown, expected: RuntimeIdentity, challenge: string, secret: string): boolean;
export function redactDiagnostics(value: unknown): string;
