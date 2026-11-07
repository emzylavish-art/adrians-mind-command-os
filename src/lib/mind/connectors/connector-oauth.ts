import type { ConnectionPublic, ConnectorId } from "./store.ts";
import {
  buildAuthorizeUrl,
  connectionStatus,
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

export async function disconnectConnector(
  connector: ConnectorId,
  input: { ownerId: string; env?: OAuthProviderEnv; fetch?: FetchLike },
): Promise<DisconnectResult> {
  return disconnectProvider(getProvider(connector), input);
}

export { isDynamicOauthConnector };
