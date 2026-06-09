import { PHOS_API_ROUTES, type PhosApiRoute } from './api-gateway-routes';
import { PHOS_DYNAMODB_TABLE_CONTRACT } from './dynamodb-table-contract';

type CloudFormationReference = { Ref: string };
type CloudFormationGetAtt = { 'Fn::GetAtt': readonly [string, string] };
type CloudFormationSub = { 'Fn::Sub': string };

type CloudFormationValue =
  | string
  | number
  | boolean
  | readonly string[]
  | CloudFormationReference
  | CloudFormationGetAtt
  | CloudFormationSub
  | readonly CloudFormationValue[]
  | { readonly [key: string]: CloudFormationValue };

type CloudFormationResource = {
  Type: string;
  Properties: Record<string, CloudFormationValue>;
};

type CloudFormationParameter = {
  Type: string;
  Default?: string;
  Description?: string;
  AllowedPattern?: string;
  MinLength?: number;
  NoEcho?: boolean;
};

export type PhosApiGatewayLambdaTemplate = {
  AWSTemplateFormatVersion: '2010-09-09';
  Description: string;
  Parameters: Record<string, CloudFormationParameter>;
  Resources: Record<string, CloudFormationResource>;
};

type PhosApiGatewayLambdaTemplateOptions = {
  api_name?: string;
  stage_name_parameter?: string;
  lambda_artifact_bucket_parameter?: string;
  lambda_artifact_key_parameter?: string;
  cognito_issuer_parameter?: string;
  cognito_audience_parameter?: string;
  dynamodb_table_name_parameter?: string;
  evidence_bucket_name_parameter?: string;
  security_event_table_name_parameter?: string;
  aurora_database_url_parameter?: string;
  lambda_runtime?: 'nodejs24.x';
};

type RouteDeploymentBinding = {
  route: PhosApiRoute;
  function_logical_id: string;
  role_logical_id: string;
  integration_logical_id: string;
  route_logical_id: string;
  permission_logical_id: string;
  lambda_handler_file: string;
  lambda_handler_export: string;
  cloudformation_handler: string;
};

function toLogicalId(input: string): string {
  const words = input
    .replace(/^@\/phos\/backend\//, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const logicalId = words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join('');
  return logicalId || 'Route';
}

function parseLambdaHandler(lambda_handler: string): {
  lambda_handler_file: string;
  lambda_handler_export: string;
  cloudformation_handler: string;
} {
  const [modulePath, exportName] = lambda_handler.split('#');
  if (!modulePath || !exportName) {
    throw new Error(`Invalid PH-OS Lambda handler reference: ${lambda_handler}`);
  }
  if (!modulePath.startsWith('@/phos/backend/') || !modulePath.endsWith('-lambda')) {
    throw new Error(`PH-OS route must point to a backend Lambda module: ${lambda_handler}`);
  }
  const lambda_handler_file = modulePath.replace('@/', 'src/');
  return {
    lambda_handler_file,
    lambda_handler_export: exportName,
    cloudformation_handler: `${lambda_handler_file}.${exportName}`,
  };
}

function toSourceArnPath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '*');
}

export function bindPhosApiRouteForDeployment(route: PhosApiRoute): RouteDeploymentBinding {
  const routeId = toLogicalId(route.route_key);
  const handler = parseLambdaHandler(route.lambda_handler);
  return {
    route,
    function_logical_id: `Phos${routeId}Function`,
    role_logical_id: `Phos${routeId}FunctionRole`,
    integration_logical_id: `Phos${routeId}Integration`,
    route_logical_id: `Phos${routeId}Route`,
    permission_logical_id: `Phos${routeId}InvokePermission`,
    ...handler,
  };
}

export function buildPhosApiRouteDeploymentBindings(
  routes: readonly PhosApiRoute[] = PHOS_API_ROUTES,
): readonly RouteDeploymentBinding[] {
  const seenRouteIds = new Set<string>();
  return routes.map((route) => {
    const binding = bindPhosApiRouteForDeployment(route);
    if (seenRouteIds.has(binding.route_logical_id)) {
      throw new Error(`Duplicate PH-OS API Gateway route logical id: ${binding.route_logical_id}`);
    }
    seenRouteIds.add(binding.route_logical_id);
    return binding;
  });
}

function ref(name: string): CloudFormationReference {
  return { Ref: name };
}

function getAtt(logicalId: string, attribute: string): CloudFormationGetAtt {
  return { 'Fn::GetAtt': [logicalId, attribute] };
}

function sub(value: string): CloudFormationSub {
  return { 'Fn::Sub': value };
}

function parameter(type: string, properties: Omit<CloudFormationParameter, 'Type'> = {}) {
  return { Type: type, ...properties };
}

function routeUsesDynamoCore(route: PhosApiRoute): boolean {
  return route.response_contract !== 'FeeRuleSearchResponse';
}

function routeUsesAurora(route: PhosApiRoute): boolean {
  return route.response_contract === 'FeeRuleSearchResponse';
}

function routeS3Actions(route: PhosApiRoute): string[] {
  if (route.route_key === 'POST /evidence/presign-upload') return ['s3:PutObject'];
  if (route.route_key === 'POST /visit-packets/{packet_id}/visit-steps/{step}') {
    return ['s3:GetObject'];
  }
  return [];
}

function buildLambdaEnvironment(input: {
  route: PhosApiRoute;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  auroraDatabaseUrlParameter: string;
  evidenceBucketNameParameter: string;
}): Record<string, CloudFormationValue> {
  return {
    ...(routeUsesDynamoCore(input.route)
      ? { PHOS_DYNAMODB_TABLE_NAME: ref(input.dynamodbTableNameParameter) }
      : {}),
    ...(routeUsesAurora(input.route)
      ? { PHOS_AURORA_DATABASE_URL: ref(input.auroraDatabaseUrlParameter) }
      : {}),
    ...(routeS3Actions(input.route).length > 0
      ? {
          PHOS_EVIDENCE_BUCKET: ref(input.evidenceBucketNameParameter),
          PHOS_EVIDENCE_BUCKET_NAME: ref(input.evidenceBucketNameParameter),
        }
      : {}),
    PHOS_SECURITY_EVENT_TABLE_NAME: ref(input.securityEventTableNameParameter),
    PHOS_SECURITY_EVENTS_DYNAMO: '1',
    NODE_ENV: 'production',
  };
}

function buildLambdaPolicyStatements(input: {
  route: PhosApiRoute;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  evidenceBucketNameParameter: string;
}): CloudFormationValue[] {
  const statements: CloudFormationValue[] = [
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/*'),
    },
    {
      Effect: 'Allow',
      Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      Resource: '*',
    },
    {
      Effect: 'Allow',
      Action: ['dynamodb:PutItem'],
      Resource: sub(
        `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${${input.securityEventTableNameParameter}}`,
      ),
    },
  ];

  if (routeUsesDynamoCore(input.route)) {
    const actions =
      input.route.method === 'GET'
        ? ['dynamodb:GetItem', 'dynamodb:Query']
        : [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
            'dynamodb:TransactWriteItems',
          ];
    statements.push({
      Effect: 'Allow',
      Action: actions,
      Resource: [
        sub(
          `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${${input.dynamodbTableNameParameter}}`,
        ),
        sub(
          `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${${input.dynamodbTableNameParameter}}/index/*`,
        ),
      ],
    });
  }

  const s3Actions = routeS3Actions(input.route);
  if (s3Actions.length > 0) {
    statements.push({
      Effect: 'Allow',
      Action: s3Actions,
      Resource: sub(`arn:aws:s3:::\${${input.evidenceBucketNameParameter}}/tenants/*/evidence/*`),
    });
  }

  return statements;
}

function buildLambdaExecutionRole(input: {
  route: PhosApiRoute;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  evidenceBucketNameParameter: string;
}): CloudFormationResource {
  return {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      Policies: [
        {
          PolicyName: 'ph-os-business-api-runtime',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: buildLambdaPolicyStatements(input),
          },
        },
      ],
    },
  };
}

function buildPhosCoreDynamoDbTable(input: {
  dynamodbTableNameParameter: string;
}): CloudFormationResource {
  const attributeNames = new Set<string>([
    PHOS_DYNAMODB_TABLE_CONTRACT.primary_key.partition_key,
    PHOS_DYNAMODB_TABLE_CONTRACT.primary_key.sort_key,
  ]);
  for (const index of Object.values(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes)) {
    attributeNames.add(index.partition_key);
    if (index.sort_key) attributeNames.add(index.sort_key);
  }

  return {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: ref(input.dynamodbTableNameParameter),
      BillingMode: PHOS_DYNAMODB_TABLE_CONTRACT.billing_mode,
      AttributeDefinitions: [...attributeNames].map((AttributeName) => ({
        AttributeName,
        AttributeType: 'S',
      })),
      KeySchema: [
        {
          AttributeName: PHOS_DYNAMODB_TABLE_CONTRACT.primary_key.partition_key,
          KeyType: 'HASH',
        },
        {
          AttributeName: PHOS_DYNAMODB_TABLE_CONTRACT.primary_key.sort_key,
          KeyType: 'RANGE',
        },
      ],
      GlobalSecondaryIndexes: Object.entries(
        PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes,
      ).map(([IndexName, index]) => ({
        IndexName,
        KeySchema: [
          {
            AttributeName: index.partition_key,
            KeyType: 'HASH',
          },
          ...(index.sort_key
            ? [
                {
                  AttributeName: index.sort_key,
                  KeyType: 'RANGE',
                },
              ]
            : []),
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      })),
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      SSESpecification: {
        SSEEnabled: true,
      },
      Tags: [
        {
          Key: 'System',
          Value: 'PH-OS',
        },
      ],
    },
  };
}

export function buildPhosApiGatewayLambdaTemplate(
  options: PhosApiGatewayLambdaTemplateOptions = {},
): PhosApiGatewayLambdaTemplate {
  const stageNameParameter = options.stage_name_parameter ?? 'StageName';
  const lambdaArtifactBucketParameter =
    options.lambda_artifact_bucket_parameter ?? 'LambdaArtifactBucket';
  const lambdaArtifactKeyParameter = options.lambda_artifact_key_parameter ?? 'LambdaArtifactKey';
  const cognitoIssuerParameter = options.cognito_issuer_parameter ?? 'CognitoIssuer';
  const cognitoAudienceParameter = options.cognito_audience_parameter ?? 'CognitoAudience';
  const dynamodbTableNameParameter =
    options.dynamodb_table_name_parameter ?? 'PhosDynamoDbTableName';
  const evidenceBucketNameParameter =
    options.evidence_bucket_name_parameter ?? 'PhosEvidenceBucketName';
  const securityEventTableNameParameter =
    options.security_event_table_name_parameter ?? 'PhosSecurityEventTableName';
  const auroraDatabaseUrlParameter =
    options.aurora_database_url_parameter ?? 'PhosAuroraDatabaseUrl';
  const runtime = options.lambda_runtime ?? 'nodejs24.x';
  const bindings = buildPhosApiRouteDeploymentBindings();

  const resources: Record<string, CloudFormationResource> = {
    PhosHttpApi: {
      Type: 'AWS::ApiGatewayV2::Api',
      Properties: {
        Name: options.api_name ?? 'ph-os-business-api',
        ProtocolType: 'HTTP',
      },
    },
    PhosApiAccessLogGroup: {
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: sub('/aws/apigateway/${PhosHttpApi}/${StageName}/access'),
        RetentionInDays: 90,
      },
    },
    PhosHttpApiStage: {
      Type: 'AWS::ApiGatewayV2::Stage',
      Properties: {
        ApiId: ref('PhosHttpApi'),
        StageName: ref(stageNameParameter),
        AutoDeploy: true,
        AccessLogSettings: {
          DestinationArn: getAtt('PhosApiAccessLogGroup', 'Arn'),
          Format:
            '{"requestId":"$context.requestId","routeKey":"$context.routeKey","status":"$context.status","integrationError":"$context.integrationErrorMessage"}',
        },
        DefaultRouteSettings: {
          DetailedMetricsEnabled: true,
        },
      },
    },
    PhosJwtAuthorizer: {
      Type: 'AWS::ApiGatewayV2::Authorizer',
      Properties: {
        ApiId: ref('PhosHttpApi'),
        Name: 'ph-os-cognito-access-token-authorizer',
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: {
          Issuer: ref(cognitoIssuerParameter),
          Audience: [ref(cognitoAudienceParameter)],
        },
      },
    },
    PhosCoreDynamoDbTable: buildPhosCoreDynamoDbTable({ dynamodbTableNameParameter }),
  };

  for (const binding of bindings) {
    resources[binding.role_logical_id] = buildLambdaExecutionRole({
      route: binding.route,
      dynamodbTableNameParameter,
      securityEventTableNameParameter,
      evidenceBucketNameParameter,
    });
    resources[binding.function_logical_id] = {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Runtime: runtime,
        Handler: binding.cloudformation_handler,
        Role: getAtt(binding.role_logical_id, 'Arn'),
        Code: {
          S3Bucket: ref(lambdaArtifactBucketParameter),
          S3Key: ref(lambdaArtifactKeyParameter),
        },
        Description: `PH-OS ${binding.route.route_key}`,
        Timeout: 30,
        MemorySize: 512,
        Architectures: ['arm64'],
        TracingConfig: {
          Mode: 'Active',
        },
        Environment: {
          Variables: buildLambdaEnvironment({
            route: binding.route,
            dynamodbTableNameParameter,
            securityEventTableNameParameter,
            auroraDatabaseUrlParameter,
            evidenceBucketNameParameter,
          }),
        },
      },
    };
    resources[binding.integration_logical_id] = {
      Type: 'AWS::ApiGatewayV2::Integration',
      Properties: {
        ApiId: ref('PhosHttpApi'),
        IntegrationType: 'AWS_PROXY',
        IntegrationMethod: 'POST',
        PayloadFormatVersion: '2.0',
        IntegrationUri: sub(
          `arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${${binding.function_logical_id}.Arn}/invocations`,
        ),
      },
    };
    resources[binding.route_logical_id] = {
      Type: 'AWS::ApiGatewayV2::Route',
      Properties: {
        ApiId: ref('PhosHttpApi'),
        RouteKey: binding.route.route_key,
        AuthorizationType: 'JWT',
        AuthorizerId: ref('PhosJwtAuthorizer'),
        AuthorizationScopes: binding.route.required_scopes,
        Target: sub(`integrations/\${${binding.integration_logical_id}}`),
      },
    };
    resources[binding.permission_logical_id] = {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Action: 'lambda:InvokeFunction',
        FunctionName: ref(binding.function_logical_id),
        Principal: 'apigateway.amazonaws.com',
        SourceArn: sub(
          `arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${PhosHttpApi}/\${${stageNameParameter}}/${binding.route.method}${toSourceArnPath(binding.route.path)}`,
        ),
      },
    };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'PH-OS business HTTP API. Next.js does not host PH-OS business API handlers.',
    Parameters: {
      [stageNameParameter]: parameter('String', { Default: 'prod', MinLength: 1 }),
      [lambdaArtifactBucketParameter]: parameter('String'),
      [lambdaArtifactKeyParameter]: parameter('String'),
      [cognitoIssuerParameter]: parameter('String'),
      [cognitoAudienceParameter]: parameter('String'),
      [dynamodbTableNameParameter]: parameter('String', {
        Default: 'phos_core',
        AllowedPattern: '^phos_core$',
        Description: 'Fixed PH-OS P0 DynamoDB single-table name.',
      }),
      [evidenceBucketNameParameter]: parameter('String'),
      [securityEventTableNameParameter]: parameter('String'),
      [auroraDatabaseUrlParameter]: parameter('String', {
        NoEcho: true,
        Description: 'Aurora PostgreSQL connection string for PH-OS FeeRule RLS access.',
      }),
    },
    Resources: resources,
  };
}
