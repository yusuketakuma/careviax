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
  DependsOn?: string | readonly string[];
  DeletionPolicy?: 'Retain';
  UpdateReplacePolicy?: 'Retain';
};

type CloudFormationParameter = {
  Type: string;
  Default?: string;
  Description?: string;
  AllowedPattern?: string;
  MinLength?: number;
  MaxLength?: number;
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
  cognito_user_pool_arn_parameter?: string;
  dynamodb_table_name_parameter?: string;
  evidence_bucket_name_parameter?: string;
  evidence_upload_allowed_origin_parameter?: string;
  security_event_table_name_parameter?: string;
  aurora_database_secret_arn_parameter?: string;
  lambda_runtime?: 'nodejs24.x';
};

type RouteDeploymentBinding = {
  route: PhosApiRoute;
  function_logical_id: string;
  log_group_logical_id: string;
  role_logical_id: string;
  integration_logical_id: string;
  route_logical_id: string;
  permission_logical_id: string;
  lambda_handler_file: string;
  lambda_handler_export: string;
  cloudformation_handler: string;
};

type DynamoRouteAccess = {
  table_actions: readonly string[];
  index_actions: readonly string[];
  index_names: readonly string[];
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

function routePathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function routePathPrefix(segments: readonly string[], length: number): string {
  return `/${segments.slice(0, length).join('/')}`;
}

function apiResourceLogicalId(pathPrefix: string): string {
  return `PhosApiResource${toLogicalId(pathPrefix)}`;
}

function apiMethodLogicalId(binding: RouteDeploymentBinding): string {
  return binding.route_logical_id;
}

export function bindPhosApiRouteForDeployment(route: PhosApiRoute): RouteDeploymentBinding {
  const routeId = toLogicalId(route.route_key);
  const handler = parseLambdaHandler(route.lambda_handler);
  return {
    route,
    function_logical_id: `Phos${routeId}Function`,
    log_group_logical_id: `Phos${routeId}FunctionLogGroup`,
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

const PHOS_ROUTE_DYNAMODB_ACCESS = {
  'GET /cards': {
    table_actions: [],
    index_actions: ['dynamodb:Query'],
    index_names: ['GSI1'],
  },
  'GET /cards/{card_id}': {
    table_actions: ['dynamodb:GetItem'],
    index_actions: [],
    index_names: [],
  },
  'POST /cards/{card_id}/actions': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'GET /capacity': {
    table_actions: ['dynamodb:GetItem'],
    index_actions: [],
    index_names: [],
  },
  'GET /claim-candidates': {
    table_actions: [],
    index_actions: ['dynamodb:Query'],
    index_names: ['GSI7', 'GSI8'],
  },
  'POST /claim-candidates/{candidate_id}/exclude': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'GET /visit-packets/{packet_id}/visit-mode': {
    table_actions: ['dynamodb:GetItem'],
    index_actions: [],
    index_names: [],
  },
  'POST /visit-packets/{packet_id}/visit-steps/{step}': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'POST /evidence/presign-upload': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'GET /handoffs': {
    table_actions: [],
    index_actions: ['dynamodb:Query'],
    index_names: ['GSI5'],
  },
  'POST /handoffs': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'POST /handoffs/{handoff_id}/resolve': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'POST /handoffs/{handoff_id}/open': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'POST /handoffs/{handoff_id}/return': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'GET /report-deliveries': {
    table_actions: [],
    index_actions: ['dynamodb:Query'],
    index_names: ['GSI6'],
  },
  'POST /report-deliveries/{delivery_id}/reply': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
  'POST /report-deliveries/{delivery_id}/action-done': {
    table_actions: ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
    index_actions: [],
    index_names: [],
  },
} as const satisfies Record<string, DynamoRouteAccess>;

function routeDynamoCoreAccess(route: PhosApiRoute): DynamoRouteAccess | undefined {
  if (route.response_contract === 'FeeRuleSearchResponse') return undefined;
  const access = (PHOS_ROUTE_DYNAMODB_ACCESS as Record<string, DynamoRouteAccess | undefined>)[
    route.route_key
  ];
  if (!access) {
    throw new Error(`Missing PH-OS DynamoDB IAM route access contract: ${route.route_key}`);
  }
  return access;
}

function routeUsesDynamoCore(route: PhosApiRoute): boolean {
  return routeDynamoCoreAccess(route) !== undefined;
}

function routeUsesAurora(route: PhosApiRoute): boolean {
  return route.response_contract === 'FeeRuleSearchResponse';
}

function routeS3Actions(route: PhosApiRoute): string[] {
  if (route.route_key === 'POST /evidence/presign-upload') {
    return ['s3:PutObject', 's3:PutObjectTagging'];
  }
  if (route.route_key === 'POST /visit-packets/{packet_id}/visit-steps/{step}') {
    return ['s3:GetObject', 's3:DeleteObject', 's3:DeleteObjectVersion', 's3:PutObjectTagging'];
  }
  return [];
}

function buildLambdaEnvironment(input: {
  route: PhosApiRoute;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  auroraDatabaseSecretArnParameter: string;
  evidenceBucketNameParameter: string;
}): Record<string, CloudFormationValue> {
  return {
    ...(routeUsesDynamoCore(input.route)
      ? { PHOS_DYNAMODB_TABLE_NAME: ref(input.dynamodbTableNameParameter) }
      : {}),
    ...(routeUsesAurora(input.route)
      ? { PHOS_AURORA_DATABASE_SECRET_ARN: ref(input.auroraDatabaseSecretArnParameter) }
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
  functionLogGroupName: string;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  auroraDatabaseSecretArnParameter: string;
  evidenceBucketNameParameter: string;
}): CloudFormationValue[] {
  const statements: CloudFormationValue[] = [
    {
      Effect: 'Allow',
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: sub(
        `arn:aws:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:${input.functionLogGroupName}:*`,
      ),
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

  const dynamoAccess = routeDynamoCoreAccess(input.route);
  if (dynamoAccess?.table_actions.length) {
    statements.push({
      Effect: 'Allow',
      Action: [...dynamoAccess.table_actions],
      Resource: sub(
        `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${${input.dynamodbTableNameParameter}}`,
      ),
    });
  }
  if (dynamoAccess?.index_actions.length) {
    statements.push({
      Effect: 'Allow',
      Action: [...dynamoAccess.index_actions],
      Resource: dynamoAccess.index_names.map((indexName) =>
        sub(
          `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${${input.dynamodbTableNameParameter}}/index/${indexName}`,
        ),
      ),
    });
  }

  if (routeUsesAurora(input.route)) {
    statements.push({
      Effect: 'Allow',
      Action: ['secretsmanager:GetSecretValue'],
      Resource: ref(input.auroraDatabaseSecretArnParameter),
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
  functionLogGroupName: string;
  dynamodbTableNameParameter: string;
  securityEventTableNameParameter: string;
  auroraDatabaseSecretArnParameter: string;
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

function buildLambdaLogGroup(input: { functionLogGroupName: string }): CloudFormationResource {
  return {
    Type: 'AWS::Logs::LogGroup',
    Properties: {
      LogGroupName: sub(input.functionLogGroupName),
      RetentionInDays: 90,
    },
  };
}

function stableNameHash(input: string): string {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

function lambdaFunctionName(input: {
  binding: RouteDeploymentBinding;
  stageNameParameter: string;
}): string {
  const routeSlug = input.binding.function_logical_id
    .replace(/^Phos/, '')
    .replace(/Function$/, '')
    .toLowerCase()
    .slice(0, 32);
  return `phos-\${${input.stageNameParameter}}-${routeSlug}-${stableNameHash(
    input.binding.route.route_key,
  )}`;
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
      ...(PHOS_DYNAMODB_TABLE_CONTRACT.ttl_attribute
        ? {
            TimeToLiveSpecification: {
              AttributeName: PHOS_DYNAMODB_TABLE_CONTRACT.ttl_attribute,
              Enabled: true,
            },
          }
        : {}),
      Tags: [
        {
          Key: 'System',
          Value: 'PH-OS',
        },
      ],
    },
  };
}

function buildPhosEvidenceBucket(input: {
  evidenceBucketNameParameter: string;
  evidenceUploadAllowedOriginParameter: string;
}): CloudFormationResource {
  return {
    Type: 'AWS::S3::Bucket',
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      BucketName: ref(input.evidenceBucketNameParameter),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: {
        Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
      VersioningConfiguration: {
        Status: 'Enabled',
      },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'ExpireUnverifiedEvidenceObjects',
            Status: 'Enabled',
            Filter: {
              And: {
                Prefix: 'tenants/',
                Tags: [
                  {
                    Key: 'phos-object-class',
                    Value: 'evidence',
                  },
                  {
                    Key: 'phos-upload-status',
                    Value: 'PRESIGNED',
                  },
                ],
              },
            },
            ExpirationInDays: 1,
          },
          {
            Id: 'AbortIncompleteEvidenceMultipartUploads',
            Status: 'Enabled',
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 1,
            },
          },
          {
            Id: 'ExpireNoncurrentEvidenceVersions',
            Status: 'Enabled',
            NoncurrentVersionExpiration: {
              NoncurrentDays: 30,
            },
          },
          {
            Id: 'RemoveExpiredEvidenceDeleteMarkers',
            Status: 'Enabled',
            ExpiredObjectDeleteMarker: true,
          },
        ],
      },
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ['PUT'],
            AllowedOrigins: [ref(input.evidenceUploadAllowedOriginParameter)],
            AllowedHeaders: [
              'Content-Type',
              'x-amz-checksum-sha256',
              'x-amz-meta-sha256',
              'x-amz-meta-size_bytes',
              'x-amz-tagging',
            ],
            ExposedHeaders: ['x-amz-checksum-sha256'],
            MaxAge: 300,
          },
        ],
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

function buildPhosEvidenceBucketPolicy(input: {
  evidenceBucketNameParameter: string;
}): CloudFormationResource {
  const bucketArn = sub(`arn:aws:s3:::\${${input.evidenceBucketNameParameter}}`);
  const objectArn = sub(`arn:aws:s3:::\${${input.evidenceBucketNameParameter}}/*`);
  return {
    Type: 'AWS::S3::BucketPolicy',
    Properties: {
      Bucket: ref(input.evidenceBucketNameParameter),
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [bucketArn, objectArn],
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
          },
        ],
      },
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
  const cognitoUserPoolArnParameter =
    options.cognito_user_pool_arn_parameter ?? 'CognitoUserPoolArn';
  const dynamodbTableNameParameter =
    options.dynamodb_table_name_parameter ?? 'PhosDynamoDbTableName';
  const evidenceBucketNameParameter =
    options.evidence_bucket_name_parameter ?? 'PhosEvidenceBucketName';
  const evidenceUploadAllowedOriginParameter =
    options.evidence_upload_allowed_origin_parameter ?? 'PhosEvidenceUploadAllowedOrigin';
  const securityEventTableNameParameter =
    options.security_event_table_name_parameter ?? 'PhosSecurityEventTableName';
  const auroraDatabaseSecretArnParameter =
    options.aurora_database_secret_arn_parameter ?? 'PhosAuroraDatabaseSecretArn';
  const runtime = options.lambda_runtime ?? 'nodejs24.x';
  const bindings = buildPhosApiRouteDeploymentBindings();

  const resources: Record<string, CloudFormationResource> = {
    PhosRestApi: {
      Type: 'AWS::ApiGateway::RestApi',
      Properties: {
        Name: options.api_name ?? 'ph-os-business-api',
        EndpointConfiguration: {
          Types: ['REGIONAL'],
        },
      },
    },
    PhosApiAccessLogGroup: {
      Type: 'AWS::Logs::LogGroup',
      Properties: {
        LogGroupName: sub(`/aws/apigateway/\${PhosRestApi}/\${${stageNameParameter}}/access`),
        RetentionInDays: 90,
      },
    },
    PhosApiGatewayCloudWatchRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'apigateway.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        ManagedPolicyArns: [
          'arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ],
      },
    },
    PhosApiGatewayAccount: {
      Type: 'AWS::ApiGateway::Account',
      Properties: {
        CloudWatchRoleArn: getAtt('PhosApiGatewayCloudWatchRole', 'Arn'),
      },
    },
    PhosCognitoAuthorizer: {
      Type: 'AWS::ApiGateway::Authorizer',
      Properties: {
        RestApiId: ref('PhosRestApi'),
        Name: 'ph-os-cognito-access-token-authorizer',
        Type: 'COGNITO_USER_POOLS',
        IdentitySource: 'method.request.header.Authorization',
        ProviderARNs: [ref(cognitoUserPoolArnParameter)],
      },
    },
    PhosRestApiDeployment: {
      Type: 'AWS::ApiGateway::Deployment',
      DependsOn: bindings.map((binding) => apiMethodLogicalId(binding)),
      Properties: {
        RestApiId: ref('PhosRestApi'),
        Description: 'PH-OS business REST API deployment with X-Ray tracing support.',
      },
    },
    PhosRestApiStage: {
      Type: 'AWS::ApiGateway::Stage',
      DependsOn: ['PhosApiGatewayAccount', 'PhosApiAccessLogGroup', 'PhosRestApiDeployment'],
      Properties: {
        RestApiId: ref('PhosRestApi'),
        DeploymentId: ref('PhosRestApiDeployment'),
        StageName: ref(stageNameParameter),
        TracingEnabled: true,
        AccessLogSetting: {
          DestinationArn: getAtt('PhosApiAccessLogGroup', 'Arn'),
          Format:
            '{"requestId":"$context.requestId","routeKey":"$context.httpMethod $context.resourcePath","status":"$context.status","integrationError":"$context.integrationErrorMessage"}',
        },
        MethodSettings: [
          {
            ResourcePath: '/*',
            HttpMethod: '*',
            MetricsEnabled: true,
            LoggingLevel: 'ERROR',
            DataTraceEnabled: false,
          },
        ],
      },
    },
    PhosCoreDynamoDbTable: buildPhosCoreDynamoDbTable({ dynamodbTableNameParameter }),
    PhosEvidenceBucket: buildPhosEvidenceBucket({
      evidenceBucketNameParameter,
      evidenceUploadAllowedOriginParameter,
    }),
    PhosEvidenceBucketPolicy: buildPhosEvidenceBucketPolicy({ evidenceBucketNameParameter }),
  };

  const apiResourcePaths = new Set<string>();
  for (const binding of bindings) {
    const segments = routePathSegments(binding.route.path);
    for (let index = 1; index <= segments.length; index += 1) {
      apiResourcePaths.add(routePathPrefix(segments, index));
    }
  }
  const sortedApiResourcePaths = [...apiResourcePaths].sort(
    (left, right) => routePathSegments(left).length - routePathSegments(right).length,
  );
  for (const pathPrefix of sortedApiResourcePaths) {
    const segments = routePathSegments(pathPrefix);
    const parentPrefix =
      segments.length > 1 ? routePathPrefix(segments, segments.length - 1) : null;
    resources[apiResourceLogicalId(pathPrefix)] = {
      Type: 'AWS::ApiGateway::Resource',
      Properties: {
        RestApiId: ref('PhosRestApi'),
        ParentId: parentPrefix
          ? ref(apiResourceLogicalId(parentPrefix))
          : getAtt('PhosRestApi', 'RootResourceId'),
        PathPart: segments[segments.length - 1]!,
      },
    };
  }

  for (const binding of bindings) {
    const functionName = lambdaFunctionName({ binding, stageNameParameter });
    const functionLogGroupName = `/aws/lambda/${functionName}`;
    resources[binding.role_logical_id] = buildLambdaExecutionRole({
      route: binding.route,
      functionLogGroupName,
      dynamodbTableNameParameter,
      securityEventTableNameParameter,
      auroraDatabaseSecretArnParameter,
      evidenceBucketNameParameter,
    });
    resources[binding.log_group_logical_id] = buildLambdaLogGroup({
      functionLogGroupName,
    });
    resources[binding.function_logical_id] = {
      Type: 'AWS::Lambda::Function',
      DependsOn: binding.log_group_logical_id,
      Properties: {
        FunctionName: sub(functionName),
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
            auroraDatabaseSecretArnParameter,
            evidenceBucketNameParameter,
          }),
        },
      },
    };
    resources[apiMethodLogicalId(binding)] = {
      Type: 'AWS::ApiGateway::Method',
      Properties: {
        RestApiId: ref('PhosRestApi'),
        ResourceId: ref(apiResourceLogicalId(binding.route.path)),
        HttpMethod: binding.route.method,
        AuthorizationType: 'COGNITO_USER_POOLS',
        AuthorizerId: ref('PhosCognitoAuthorizer'),
        AuthorizationScopes: binding.route.required_scopes,
        Integration: {
          Type: 'AWS_PROXY',
          IntegrationHttpMethod: 'POST',
          Uri: sub(
            `arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/\${${binding.function_logical_id}.Arn}/invocations`,
          ),
        },
      },
    };
    resources[binding.permission_logical_id] = {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Action: 'lambda:InvokeFunction',
        FunctionName: ref(binding.function_logical_id),
        Principal: 'apigateway.amazonaws.com',
        SourceArn: sub(
          `arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${PhosRestApi}/\${${stageNameParameter}}/${binding.route.method}${toSourceArnPath(binding.route.path)}`,
        ),
      },
    };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'PH-OS business REST API with API Gateway and Lambda X-Ray tracing. Next.js does not host PH-OS business API handlers.',
    Parameters: {
      [stageNameParameter]: parameter('String', {
        Default: 'prod',
        MinLength: 1,
        MaxLength: 16,
        AllowedPattern: '^[A-Za-z0-9-]+$',
      }),
      [lambdaArtifactBucketParameter]: parameter('String'),
      [lambdaArtifactKeyParameter]: parameter('String'),
      [cognitoUserPoolArnParameter]: parameter('String', {
        Description: 'Cognito User Pool ARN used by the PH-OS API Gateway REST authorizer.',
      }),
      [dynamodbTableNameParameter]: parameter('String', {
        Default: 'phos_core',
        AllowedPattern: '^phos_core$',
        Description: 'Fixed PH-OS P0 DynamoDB single-table name.',
      }),
      [evidenceBucketNameParameter]: parameter('String'),
      [evidenceUploadAllowedOriginParameter]: parameter('String', {
        AllowedPattern: '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$',
        Description: 'HTTPS origin allowed to PUT PH-OS evidence objects through presigned URLs.',
      }),
      [securityEventTableNameParameter]: parameter('String'),
      [auroraDatabaseSecretArnParameter]: parameter('String', {
        Description: 'Secrets Manager ARN containing the PH-OS Aurora PostgreSQL connection URL.',
      }),
    },
    Resources: resources,
  };
}
