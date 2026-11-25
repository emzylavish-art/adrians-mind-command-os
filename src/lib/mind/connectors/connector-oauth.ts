import type { ConnectionPublic, ConnectorId } from "./store.ts";
import {
  buildAuthorizeUrl,
  buildAuthorizeUrlPersistent,
  connectionStatus,
  connectionStatusPersistent,
  disconnectProvider,
  exchangeAuthorizationCode,
  type DisconnectResult,
  type FetchLike,
  type OAuthProviderEnv,
} from "./oauth-provider.ts";
import { getProvider, isDynamicOauthConnector } from "./providers.ts";

export function buildConnectorAuthorizeUrl(
  connector: ConnectorId,
  input: { ownerId: string; env?: OAuthProviderEnv },
) {
  return buildAuthorizeUrl(getProvider(connector), input);
}

/** Serverless-safe connection start (database-backed when configured). */
export async function buildConnectorAuthorizeUrlPersistent(
  connector: ConnectorId,
  input: { ownerId: string; env?: OAuthProviderEnv },
) {
  return buildAuthorizeUrlPersistent(getProvider(connector), input);
}

export async function exchangeConnectorCode(
  connector: ConnectorId,
  input: { code: string; state: string; expectedOwnerId?: string; env?: OAuthProviderEnv; fetch?: FetchLike },
) {
  return exchangeAuthorizationCode(getProvider(connector), input);
}

export function connectorConnectionStatus(
  connector: ConnectorId,
  ownerId: string,
  env?: OAuthProviderEnv,
): ConnectionPublic {
  const provider = getProvider(connector);
  const status = connectionStatus(provider, ownerId, env);
  if (status.state === "not_configured" && provider.notConfiguredDetail) {
    return { ...status, detail: provider.notConfiguredDetail };
  }
  return status;
}

export async function connectorConnectionStatusPersistent(
  connector: ConnectorId,
  ownerId: string,
  env?: OAuthProviderEnv,
): Promise<ConnectionPublic> {
  const provider = getProvider(connector);
  const status = await connectionStatusPersistent(provider, ownerId, env);
  if (status.state === "not_configured" && provider.notConfiguredDetail) {
    return { ...status, detail: provider.notConfiguredDetail };
  }
  return status;
}

export async function disconnectConnector(
  connector: ConnectorId,
  input: { ownerId: string; env?: OAuthProviderEnv; fetch?: FetchLike; expectedConnectedAt?: string },
): Promise<DisconnectResult> {
  return disconnectProvider(getProvider(connector), input);
}

export { isDynamicOauthConnector };
