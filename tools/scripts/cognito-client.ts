import {
  CognitoIdentityProviderClient,
  type CognitoIdentityProviderClient as AwsCognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { scriptAwsClientConfig, withScriptAwsClientTimeout } from './aws-client';

const cachedCognitoClients = new Map<string, Pick<AwsCognitoIdentityProviderClient, 'send'>>();

export function getScriptCognitoClient(
  region: string,
): Pick<AwsCognitoIdentityProviderClient, 'send'> {
  const cached = cachedCognitoClients.get(region);
  if (cached) return cached;

  const client = withScriptAwsClientTimeout(
    new CognitoIdentityProviderClient({ region, ...scriptAwsClientConfig() }),
  );
  cachedCognitoClients.set(region, client);
  return client;
}
