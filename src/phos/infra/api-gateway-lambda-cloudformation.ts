import type { PhosApiRoute } from './api-gateway-routes';

export type CloudFormationReference = { Ref: string };

export type CloudFormationGetAtt = { 'Fn::GetAtt': readonly [string, string] };

export type CloudFormationSub = { 'Fn::Sub': string };

export type CloudFormationValue =
  | string
  | number
  | boolean
  | readonly string[]
  | CloudFormationReference
  | CloudFormationGetAtt
  | CloudFormationSub
  | readonly CloudFormationValue[]
  | { readonly [key: string]: CloudFormationValue };

export type CloudFormationResource = {
  Type: string;
  Properties: Record<string, CloudFormationValue>;
  DependsOn?: string | readonly string[];
  DeletionPolicy?: 'Retain';
  UpdateReplacePolicy?: 'Retain';
};

export type CloudFormationParameter = {
  Type: string;
  Default?: string;
  Description?: string;
  AllowedPattern?: string;
  MinLength?: number;
  MaxLength?: number;
  NoEcho?: boolean;
};

export type CloudFormationOutput = {
  Description?: string;
  Value: CloudFormationValue;
};

export type PhosApiGatewayLambdaTemplate = {
  AWSTemplateFormatVersion: '2010-09-09';
  Description: string;
  Parameters: Record<string, CloudFormationParameter>;
  Resources: Record<string, CloudFormationResource>;
  Outputs: Record<string, CloudFormationOutput>;
};

export type PhosApiGatewayLambdaTemplateOptions = {
  api_name?: string;
  routes?: readonly PhosApiRoute[];
  stage_name_parameter?: string;
  lambda_artifact_bucket_parameter?: string;
  lambda_artifact_key_parameter?: string;
  jwt_issuer_parameter?: string;
  jwt_audience_parameter?: string;
  dynamodb_table_name_parameter?: string;
  dynamodb_kms_key_arn_parameter?: string;
  evidence_bucket_name_parameter?: string;
  evidence_kms_key_arn_parameter?: string;
  evidence_upload_allowed_origin_parameter?: string;
  cognito_user_pool_arn_parameter?: string;
  security_event_table_name_parameter?: string;
  aurora_database_secret_arn_parameter?: string;
  lambda_runtime?: 'nodejs24.x';
};

export function ref(name: string): CloudFormationReference {
  return { Ref: name };
}

export function getAtt(logicalId: string, attribute: string): CloudFormationGetAtt {
  return { 'Fn::GetAtt': [logicalId, attribute] };
}

export function sub(value: string): CloudFormationSub {
  return { 'Fn::Sub': value };
}

export function parameter(type: string, properties: Omit<CloudFormationParameter, 'Type'> = {}) {
  return { Type: type, ...properties };
}

export function stableNameHash(input: string): string {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}
