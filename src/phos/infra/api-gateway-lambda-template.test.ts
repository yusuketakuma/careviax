import { describe, expect, it } from 'vitest';
import { PHOS_API_ROUTES } from './api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
  buildPhosApiRouteDeploymentBindings,
} from './api-gateway-lambda-template';
import { PHOS_DYNAMODB_TABLE_CONTRACT } from './dynamodb-table-contract';

function resourcesByType(type: string) {
  const template = buildPhosApiGatewayLambdaTemplate();
  return Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);
}

function policyStatementsForRoute(routeKey: string) {
  const template = buildPhosApiGatewayLambdaTemplate();
  const binding = bindPhosApiRouteForDeployment(
    PHOS_API_ROUTES.find((route) => route.route_key === routeKey)!,
  );
  const policies = template.Resources[binding.role_logical_id].Properties.Policies as Array<{
    PolicyDocument: { Statement: Array<{ Action: string[]; Resource: unknown }> };
  }>;
  return policies[0].PolicyDocument.Statement;
}

function resourceSubValues(resource: unknown): string[] {
  if (Array.isArray(resource)) return resource.flatMap(resourceSubValues);
  if (
    resource &&
    typeof resource === 'object' &&
    'Fn::Sub' in resource &&
    typeof resource['Fn::Sub'] === 'string'
  ) {
    return [resource['Fn::Sub']];
  }
  return [];
}

function coreDynamoStatementsForRoute(routeKey: string) {
  return policyStatementsForRoute(routeKey).filter((statement) =>
    resourceSubValues(statement.Resource).some((resource) =>
      resource.includes('${PhosDynamoDbTableName}'),
    ),
  );
}

function coreActionsForRoute(routeKey: string): string[] {
  return coreDynamoStatementsForRoute(routeKey).flatMap((statement) => statement.Action);
}

function allActionsForRoute(routeKey: string): string[] {
  return policyStatementsForRoute(routeKey).flatMap((statement) => statement.Action);
}

function statementWithAction(routeKey: string, action: string) {
  return policyStatementsForRoute(routeKey).find((statement) => statement.Action.includes(action));
}

describe('PH-OS API Gateway/Lambda deployment template', () => {
  it('emits CloudFormation parameters and resources with deployable top-level shapes', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    for (const parameter of Object.values(template.Parameters)) {
      expect(parameter.Type).toBe('String');
      expect(parameter).not.toHaveProperty('Properties');
    }
    for (const resource of Object.values(template.Resources)) {
      expect(resource.Type).toMatch(/^AWS::/);
      expect(resource.Properties).toBeDefined();
    }
  });

  it('derives one deployment binding from every implemented route manifest entry', () => {
    const bindings = buildPhosApiRouteDeploymentBindings();

    expect(bindings).toHaveLength(PHOS_API_ROUTES.length);
    expect(bindings.map((binding) => binding.route.route_key).sort()).toEqual(
      PHOS_API_ROUTES.map((route) => route.route_key).sort(),
    );

    for (const binding of bindings) {
      expect(binding.lambda_handler_file).toMatch(/^src\/phos\/backend\/.+-lambda$/);
      expect(binding.lambda_handler_file).not.toContain('src/app/api');
      expect(binding.cloudformation_handler).toBe(
        `${binding.lambda_handler_file}.${binding.lambda_handler_export}`,
      );
      expect(binding.cloudformation_handler).not.toContain('#');
      expect(binding.route.lambda_handler).not.toContain('route.ts');
    }
  });

  it('creates an HTTP API with a Cognito JWT authorizer for access-token scoped routes', () => {
    const template = buildPhosApiGatewayLambdaTemplate({
      api_name: 'ph-os-business-api-test',
    });

    expect(template.Resources.PhosHttpApi).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Api',
      Properties: {
        Name: 'ph-os-business-api-test',
        ProtocolType: 'HTTP',
      },
    });
    expect(template.Resources.PhosJwtAuthorizer).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Authorizer',
      Properties: {
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: {
          Issuer: { Ref: 'CognitoIssuer' },
          Audience: [{ Ref: 'CognitoAudience' }],
        },
      },
    });
    expect(template.Resources.PhosHttpApiStage).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Stage',
      Properties: {
        AutoDeploy: true,
        DefaultRouteSettings: {
          DetailedMetricsEnabled: true,
        },
      },
    });
  });

  it('creates only API Gateway JWT routes with manifest scopes', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const routeResources = resourcesByType('AWS::ApiGatewayV2::Route');

    expect(routeResources).toHaveLength(PHOS_API_ROUTES.length);
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.route_logical_id]).toMatchObject({
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          RouteKey: route.route_key,
          AuthorizationType: 'JWT',
          AuthorizerId: { Ref: 'PhosJwtAuthorizer' },
          AuthorizationScopes: route.required_scopes,
        },
      });
    }
  });

  it('creates Lambda functions with Node.js 24 active tracing and production PH-OS environment', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const functionResources = resourcesByType('AWS::Lambda::Function');

    expect(functionResources).toHaveLength(PHOS_API_ROUTES.length);
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.function_logical_id]).toMatchObject({
        Type: 'AWS::Lambda::Function',
        Properties: {
          Runtime: 'nodejs24.x',
          Handler: binding.cloudformation_handler,
          Role: { 'Fn::GetAtt': [binding.role_logical_id, 'Arn'] },
          Architectures: ['arm64'],
          TracingConfig: {
            Mode: 'Active',
          },
          Environment: {
            Variables: {
              PHOS_SECURITY_EVENT_TABLE_NAME: { Ref: 'PhosSecurityEventTableName' },
              PHOS_SECURITY_EVENTS_DYNAMO: '1',
              NODE_ENV: 'production',
            },
          },
        },
      });
    }
  });

  it('treats the Aurora database URL as a non-echoed deploy parameter', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Parameters.PhosAuroraDatabaseUrl).toMatchObject({
      Type: 'String',
      NoEcho: true,
    });
    expect(JSON.stringify(template)).not.toContain('postgres://');
    expect(JSON.stringify(template)).not.toContain('postgresql://');
  });

  it('creates the PH-OS core DynamoDB table with the contract primary key and GSIs', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Resources.PhosCoreDynamoDbTable).toMatchObject({
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: { Ref: 'PhosDynamoDbTableName' },
        BillingMode: PHOS_DYNAMODB_TABLE_CONTRACT.billing_mode,
        AttributeDefinitions: expect.arrayContaining([
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
          { AttributeName: 'GSI3PK', AttributeType: 'S' },
          { AttributeName: 'GSI3SK', AttributeType: 'S' },
          { AttributeName: 'GSI4PK', AttributeType: 'S' },
          { AttributeName: 'GSI4SK', AttributeType: 'S' },
          { AttributeName: 'GSI5PK', AttributeType: 'S' },
          { AttributeName: 'GSI5SK', AttributeType: 'S' },
          { AttributeName: 'GSI6PK', AttributeType: 'S' },
          { AttributeName: 'GSI6SK', AttributeType: 'S' },
          { AttributeName: 'GSI7PK', AttributeType: 'S' },
          { AttributeName: 'GSI7SK', AttributeType: 'S' },
          { AttributeName: 'GSI8PK', AttributeType: 'S' },
        ]),
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: expect.arrayContaining([
          expect.objectContaining({ IndexName: 'GSI1' }),
          expect.objectContaining({ IndexName: 'GSI2' }),
          expect.objectContaining({ IndexName: 'GSI3' }),
          expect.objectContaining({ IndexName: 'GSI4' }),
          expect.objectContaining({ IndexName: 'GSI5' }),
          expect.objectContaining({ IndexName: 'GSI6' }),
          expect.objectContaining({ IndexName: 'GSI7' }),
          expect.objectContaining({ IndexName: 'GSI8' }),
        ]),
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: { SSEEnabled: true },
        TimeToLiveSpecification: {
          AttributeName: PHOS_DYNAMODB_TABLE_CONTRACT.ttl_attribute,
          Enabled: true,
        },
      },
    });
    expect(template.Parameters.PhosDynamoDbTableName).toMatchObject({
      Default: 'phos_core',
      AllowedPattern: '^phos_core$',
    });
  });

  it('creates the PH-OS evidence bucket with private encrypted upload controls', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Parameters.PhosEvidenceUploadAllowedOrigin).toMatchObject({
      Type: 'String',
      AllowedPattern: '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$',
    });
    expect(template.Resources.PhosEvidenceBucket).toMatchObject({
      Type: 'AWS::S3::Bucket',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: {
        BucketName: { Ref: 'PhosEvidenceBucketName' },
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
          Rules: expect.arrayContaining([
            expect.objectContaining({
              Id: 'ExpireUnverifiedEvidenceObjects',
              Status: 'Enabled',
              Filter: {
                And: {
                  Prefix: 'tenants/',
                  Tags: [
                    { Key: 'phos-object-class', Value: 'evidence' },
                    { Key: 'phos-upload-status', Value: 'PRESIGNED' },
                  ],
                },
              },
              ExpirationInDays: 1,
            }),
            expect.objectContaining({
              Id: 'AbortIncompleteEvidenceMultipartUploads',
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            }),
            expect.objectContaining({
              Id: 'ExpireNoncurrentEvidenceVersions',
              NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            }),
            expect.objectContaining({
              Id: 'RemoveExpiredEvidenceDeleteMarkers',
              ExpiredObjectDeleteMarker: true,
            }),
          ]),
        },
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedMethods: ['PUT'],
              AllowedOrigins: [{ Ref: 'PhosEvidenceUploadAllowedOrigin' }],
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
      },
    });
    expect(JSON.stringify(template.Resources.PhosEvidenceBucket)).not.toContain(
      '"AllowedOrigins":["*"]',
    );
    expect(JSON.stringify(template.Resources.PhosEvidenceBucket)).not.toContain(
      '"ExpirationInDays":365',
    );
    expect(template.Resources.PhosEvidenceBucketPolicy).toMatchObject({
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        Bucket: { Ref: 'PhosEvidenceBucketName' },
        PolicyDocument: {
          Statement: [
            {
              Sid: 'DenyInsecureTransport',
              Effect: 'Deny',
              Principal: '*',
              Action: 's3:*',
              Resource: [
                { 'Fn::Sub': 'arn:aws:s3:::${PhosEvidenceBucketName}' },
                { 'Fn::Sub': 'arn:aws:s3:::${PhosEvidenceBucketName}/*' },
              ],
              Condition: {
                Bool: {
                  'aws:SecureTransport': 'false',
                },
              },
            },
          ],
        },
      },
    });
  });

  it('keeps evidence upload CORS origin scoped to one exact HTTPS origin', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const allowedPattern = template.Parameters.PhosEvidenceUploadAllowedOrigin.AllowedPattern;
    expect(allowedPattern).toBeDefined();
    const originPattern = new RegExp(allowedPattern!);

    expect(originPattern.test('https://app.example.com')).toBe(true);
    expect(originPattern.test('https://app.example.com:443')).toBe(true);
    expect(originPattern.test('http://app.example.com')).toBe(false);
    expect(originPattern.test('https://*.example.com')).toBe(false);
    expect(originPattern.test('https://app.example.com,https://evil.example.com')).toBe(false);
    expect(originPattern.test('https://app.example.com/upload')).toBe(false);
  });

  it('creates per-route Lambda execution roles with capability-scoped permissions and env', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const roleResources = resourcesByType('AWS::IAM::Role');

    expect(template.Resources).not.toHaveProperty('PhosLambdaExecutionRole');
    expect(roleResources).toHaveLength(PHOS_API_ROUTES.length);
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.role_logical_id]).toMatchObject({
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          Policies: [
            {
              PolicyDocument: {
                Statement: expect.arrayContaining([
                  expect.objectContaining({
                    Action: expect.arrayContaining(['logs:PutLogEvents']),
                  }),
                  expect.objectContaining({
                    Action: expect.arrayContaining(['xray:PutTraceSegments']),
                  }),
                  expect.objectContaining({
                    Action: expect.arrayContaining(['dynamodb:PutItem']),
                    Resource: {
                      'Fn::Sub':
                        'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosSecurityEventTableName}',
                    },
                  }),
                ]),
              },
            },
          ],
        },
      });
    }
  });

  it('does not give read-only or Aurora-only routes evidence or write-capability runtime config', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const capacity = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'GET /capacity')!,
    );
    const feeRules = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'GET /fee-rules')!,
    );
    const evidence = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'POST /evidence/presign-upload')!,
    );
    const visitStep = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find(
        (route) => route.route_key === 'POST /visit-packets/{packet_id}/visit-steps/{step}',
      )!,
    );

    expect(template.Resources[capacity.function_logical_id].Properties.Environment).toMatchObject({
      Variables: {
        PHOS_DYNAMODB_TABLE_NAME: { Ref: 'PhosDynamoDbTableName' },
      },
    });
    expect(JSON.stringify(template.Resources[capacity.function_logical_id])).not.toContain(
      'PHOS_EVIDENCE_BUCKET',
    );
    expect(JSON.stringify(template.Resources[capacity.function_logical_id])).not.toContain(
      'PHOS_AURORA_DATABASE_URL',
    );
    expect(JSON.stringify(template.Resources[capacity.role_logical_id])).not.toContain(
      'dynamodb:TransactWriteItems',
    );
    expect(JSON.stringify(template.Resources[capacity.role_logical_id])).not.toContain(
      'dynamodb:Query',
    );
    expect(JSON.stringify(template.Resources[capacity.role_logical_id])).not.toContain(
      's3:PutObject',
    );

    expect(template.Resources[feeRules.function_logical_id].Properties.Environment).toMatchObject({
      Variables: {
        PHOS_AURORA_DATABASE_URL: { Ref: 'PhosAuroraDatabaseUrl' },
      },
    });
    expect(JSON.stringify(template.Resources[feeRules.function_logical_id])).not.toContain(
      'PHOS_DYNAMODB_TABLE_NAME',
    );
    expect(JSON.stringify(template.Resources[feeRules.function_logical_id])).not.toContain(
      'PHOS_EVIDENCE_BUCKET',
    );

    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain('s3:PutObject');
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      'arn:aws:s3:::${PhosEvidenceBucketName}/tenants/*/evidence/*',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).not.toContain(
      's3:GetObject',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).not.toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain('s3:GetObject');
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      'arn:aws:s3:::${PhosEvidenceBucketName}/tenants/*/evidence/*',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).not.toContain(
      '"s3:PutObject"',
    );
  });

  it('grants route-specific DynamoDB core actions without broad write or index permissions', () => {
    const expected = new Map<string, readonly string[]>([
      ['GET /cards', ['dynamodb:Query']],
      ['GET /cards/{card_id}', ['dynamodb:GetItem']],
      ['POST /cards/{card_id}/actions', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['GET /capacity', ['dynamodb:GetItem']],
      ['GET /claim-candidates', ['dynamodb:Query']],
      [
        'POST /claim-candidates/{candidate_id}/exclude',
        ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
      ],
      ['GET /visit-packets/{packet_id}/visit-mode', ['dynamodb:GetItem']],
      [
        'POST /visit-packets/{packet_id}/visit-steps/{step}',
        ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
      ],
      ['POST /evidence/presign-upload', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['GET /handoffs', ['dynamodb:Query']],
      ['POST /handoffs', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['POST /handoffs/{handoff_id}/resolve', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['POST /handoffs/{handoff_id}/open', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['POST /handoffs/{handoff_id}/return', ['dynamodb:GetItem', 'dynamodb:TransactWriteItems']],
      ['GET /report-deliveries', ['dynamodb:Query']],
      [
        'POST /report-deliveries/{delivery_id}/reply',
        ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
      ],
      [
        'POST /report-deliveries/{delivery_id}/action-done',
        ['dynamodb:GetItem', 'dynamodb:TransactWriteItems'],
      ],
    ]);

    for (const route of PHOS_API_ROUTES) {
      const routeActions = allActionsForRoute(route.route_key);
      const coreActions = coreActionsForRoute(route.route_key);
      const expectedCoreActions = expected.get(route.route_key) ?? [];

      expect(coreActions.sort(), route.route_key).toEqual([...expectedCoreActions].sort());
      expect(coreActions, route.route_key).not.toContain('dynamodb:PutItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:UpdateItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:DeleteItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:BatchWriteItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:Scan');
      expect(routeActions, route.route_key).toContain('dynamodb:PutItem');
      expect(
        policyStatementsForRoute(route.route_key).filter(
          (statement) =>
            statement.Action.includes('dynamodb:PutItem') &&
            resourceSubValues(statement.Resource).includes(
              'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosSecurityEventTableName}',
            ),
        ),
        route.route_key,
      ).toHaveLength(1);
      if (route.route_key !== 'GET /fee-rules') {
        expect(coreDynamoStatementsForRoute(route.route_key), route.route_key).not.toHaveLength(0);
      }
    }
  });

  it('scopes DynamoDB Query routes to index resources and mutation routes to table resources', () => {
    const expectedQueryIndexes = new Map<string, readonly string[]>([
      ['GET /cards', ['GSI1']],
      ['GET /claim-candidates', ['GSI7', 'GSI8']],
      ['GET /handoffs', ['GSI5']],
      ['GET /report-deliveries', ['GSI6']],
    ]);

    for (const [routeKey, indexNames] of expectedQueryIndexes) {
      expect(statementWithAction(routeKey, 'dynamodb:Query')).toMatchObject({
        Resource: indexNames.map((indexName) => ({
          'Fn::Sub': `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/\${PhosDynamoDbTableName}/index/${indexName}`,
        })),
      });
      expect(JSON.stringify(statementWithAction(routeKey, 'dynamodb:Query'))).not.toContain(
        '/index/*',
      );
      expect(coreActionsForRoute(routeKey)).not.toContain('dynamodb:GetItem');
      expect(coreActionsForRoute(routeKey)).not.toContain('dynamodb:TransactWriteItems');
    }

    for (const routeKey of [
      'POST /cards/{card_id}/actions',
      'POST /claim-candidates/{candidate_id}/exclude',
      'POST /visit-packets/{packet_id}/visit-steps/{step}',
      'POST /evidence/presign-upload',
      'POST /handoffs',
      'POST /report-deliveries/{delivery_id}/reply',
    ]) {
      expect(statementWithAction(routeKey, 'dynamodb:TransactWriteItems')).toMatchObject({
        Resource: {
          'Fn::Sub':
            'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosDynamoDbTableName}',
        },
      });
      expect(coreActionsForRoute(routeKey)).not.toContain('dynamodb:Query');
    }

    expect(JSON.stringify(buildPhosApiGatewayLambdaTemplate())).not.toContain('/index/*');
  });

  it('uses API Gateway proxy integrations and scoped Lambda invoke permissions for every route', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.integration_logical_id]).toMatchObject({
        Type: 'AWS::ApiGatewayV2::Integration',
        Properties: {
          IntegrationType: 'AWS_PROXY',
          IntegrationMethod: 'POST',
          PayloadFormatVersion: '2.0',
        },
      });
      expect(template.Resources[binding.permission_logical_id]).toMatchObject({
        Type: 'AWS::Lambda::Permission',
        Properties: {
          Action: 'lambda:InvokeFunction',
          FunctionName: { Ref: binding.function_logical_id },
          Principal: 'apigateway.amazonaws.com',
        },
      });
    }
  });

  it('wildcards path parameters in Lambda invoke permissions without broadening to all methods', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const detailRoute = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'GET /cards/{card_id}')!,
    );
    const actionRoute = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'POST /cards/{card_id}/actions')!,
    );

    expect(template.Resources[detailRoute.permission_logical_id].Properties.SourceArn).toEqual({
      'Fn::Sub':
        'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${PhosHttpApi}/${StageName}/GET/cards/*',
    });
    expect(template.Resources[actionRoute.permission_logical_id].Properties.SourceArn).toEqual({
      'Fn::Sub':
        'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${PhosHttpApi}/${StageName}/POST/cards/*/actions',
    });
  });

  it('does not emit planned-route, status, or Next.js API resources', () => {
    const templateJson = JSON.stringify(buildPhosApiGatewayLambdaTemplate());
    const legacyMarkers = [
      'PLAN' + 'NED',
      'IMPLE' + 'MENTED',
      'src/app' + '/api',
      '/api' + '/phos',
      'route' + '.ts',
    ];

    for (const marker of legacyMarkers) {
      expect(templateJson).not.toContain(marker);
    }
  });
});
