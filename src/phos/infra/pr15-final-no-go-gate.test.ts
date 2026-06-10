import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import {
  buildCloudWatchEmbeddedMetric,
  P0_REQUIRED_METRIC_NAMES,
} from '@/phos/backend/observability';
import { CARD_ACTION_ROUTE_ACTION_CODES } from '@/phos/backend/card-action-executor';
import { PHOS_API_ROUTES } from './api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
} from './api-gateway-lambda-template';
import { PHOS_DYNAMODB_TABLE_CONTRACT } from './dynamodb-table-contract';

const repoRoot = process.cwd();
const canonicalRoot = join(repoRoot, 'src/phos');
const phosAppRoot = join(repoRoot, 'src/app/(phos)');

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function readRelative(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function readSub(value: unknown): string {
  expect(value).toEqual(expect.objectContaining({ 'Fn::Sub': expect.any(String) }));
  return (value as { 'Fn::Sub': string })['Fn::Sub'];
}

function expectEvidence(path: string, patterns: readonly RegExp[]) {
  const fullPath = join(repoRoot, path);
  expect(existsSync(fullPath), path).toBe(true);
  const content = readFileSync(fullPath, 'utf8');
  for (const pattern of patterns) {
    expect(content, path).toMatch(pattern);
  }
}

function expectMissingFiles(paths: readonly string[]) {
  for (const path of paths) {
    expect(existsSync(join(repoRoot, path)), path).toBe(false);
  }
}

describe('PH-OS PR-15 E2E evidence gate', () => {
  it('keeps E2E-01 through E2E-11 in one executable final workflow spec', () => {
    const spec = readRelative('src/phos/infra/phos-final-e2e.test.tsx');

    for (let index = 1; index <= 11; index++) {
      const id = `E2E-${String(index).padStart(2, '0')}`;
      expect(spec, id).toContain(`it('${id}`);
    }
  });
});

describe('PH-OS Final No-Go gate', () => {
  it('has one transition matrix entry for every ActionCode value', () => {
    expect(Object.keys(ACTION_TRANSITION_MATRIX).sort()).toEqual(Object.values(ActionCode).sort());
  });

  it('maps every ActionCode to either the card action route or a canonical detached route handler', () => {
    const cardRouteOwned = new Set<ActionCode>(CARD_ACTION_ROUTE_ACTION_CODES);
    const detachedRouteOwners = new Map<ActionCode, readonly string[]>([
      [ActionCode.EXCLUDE_CLAIM_CANDIDATE, ['POST /claim-candidates/{candidate_id}/exclude']],
      [
        ActionCode.UPLOAD_EVIDENCE,
        ['POST /evidence/presign-upload', 'POST /visit-packets/{packet_id}/visit-steps/{step}'],
      ],
      [ActionCode.CREATE_HANDOFF_TO_PHARMACIST, ['POST /handoffs']],
      [
        ActionCode.MARK_REPORT_WAITING_REPLY,
        ['POST /cards/{card_id}/actions', 'GET /report-deliveries'],
      ],
      [ActionCode.REGISTER_REPORT_REPLY, ['POST /report-deliveries/{delivery_id}/reply']],
      [ActionCode.MARK_REPORT_ACTION_DONE, ['POST /report-deliveries/{delivery_id}/action-done']],
    ]);
    const routeKeys = new Set<string>(PHOS_API_ROUTES.map((route) => route.route_key));

    for (const actionCode of Object.values(ActionCode)) {
      const routeOwners = detachedRouteOwners.get(actionCode);
      if (cardRouteOwned.has(actionCode)) {
        expect(routeKeys.has('POST /cards/{card_id}/actions'), actionCode).toBe(true);
        expect(routeOwners, actionCode).toBeUndefined();
        continue;
      }
      expect(routeOwners, actionCode).toBeDefined();
      for (const routeOwner of routeOwners ?? []) {
        expect(routeKeys.has(routeOwner), `${actionCode} -> ${routeOwner}`).toBe(true);
      }
    }
  });

  it('keeps every mutating PH-OS business route on Lambda with replay or explicit presign semantics', () => {
    for (const route of PHOS_API_ROUTES) {
      expect(route.lambda_handler).toMatch(/^@\/phos\/backend\/.*-lambda#/);

      if (route.method !== 'POST') {
        expect(route.requires_idempotency_key).toBe(false);
        expect(route.requires_expected_version).toBe(false);
        continue;
      }

      if (route.route_key === 'POST /evidence/presign-upload') {
        expect(route.requires_idempotency_key).toBe(true);
        expect(route.requires_expected_version).toBe(false);
        continue;
      }

      expect(route.requires_idempotency_key).toBe(true);
      expect(route.requires_expected_version).toBe(true);
    }
  });

  it('keeps the API Gateway to Lambda template deployable with parameters and execution roles', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    for (const parameter of Object.values(template.Parameters)) {
      expect(parameter).not.toHaveProperty('Properties');
      expect(parameter.Type).toBe('String');
    }
    expect(template.Resources.PhosHttpApi).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Api',
      Properties: { ProtocolType: 'HTTP' },
    });
    expect(template.Resources.PhosJwtAuthorizer).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Authorizer',
      Properties: {
        AuthorizerType: 'JWT',
        IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: {
          Issuer: { Ref: 'JwtIssuer' },
          Audience: [{ Ref: 'JwtAudience' }],
        },
      },
    });
    expect(template.Resources.PhosHttpApiStage).toMatchObject({
      Type: 'AWS::ApiGatewayV2::Stage',
      Properties: {
        AutoDeploy: true,
        AccessLogSettings: {
          DestinationArn: { 'Fn::GetAtt': ['PhosApiAccessLogGroup', 'Arn'] },
        },
        DefaultRouteSettings: {
          DetailedMetricsEnabled: true,
        },
      },
    });
    const accessLogFormat = template.Resources.PhosHttpApiStage.Properties.AccessLogSettings as {
      Format: string;
    };
    expect(accessLogFormat.Format).toContain('$context.authorizer.claims.tenant_id');
    expect(accessLogFormat.Format).toContain('$context.authorizer.claims.sub');
    expect(accessLogFormat.Format).not.toMatch(
      /patient|patient_name|drug|medication|report_body|photo|sha256|file_name/i,
    );
    expect(template.Parameters.PhosSecurityEventTableName).toMatchObject({
      Default: 'phos_security_events',
      AllowedPattern: '^phos_security_events$',
    });
    expect(template.Parameters.PhosDynamoDbKmsKeyArn).toMatchObject({
      AllowedPattern: '^arn:aws:kms:[A-Za-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$',
    });
    expect(template.Parameters.PhosEvidenceKmsKeyArn).toMatchObject({
      AllowedPattern: '^arn:aws:kms:[A-Za-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$',
    });
    expect(template.Parameters.PhosSecurityEventTableName.Default).not.toBe(
      template.Parameters.PhosDynamoDbTableName.Default,
    );
    expect(template.Resources.PhosCognitoPreTokenGenerationFunction).toMatchObject({
      Type: 'AWS::Lambda::Function',
      Properties: {
        Handler: 'src/phos/backend/cognito-pre-token-generation.handler',
      },
    });
    expect(template.Resources.PhosCognitoPreTokenGenerationInvokePermission).toMatchObject({
      Type: 'AWS::Lambda::Permission',
      Properties: {
        Principal: 'cognito-idp.amazonaws.com',
        SourceArn: { Ref: 'PhosCognitoUserPoolArn' },
      },
    });
    expect(template.Outputs.PhosCognitoPreTokenGenerationFunctionArn).toMatchObject({
      Value: { 'Fn::GetAtt': ['PhosCognitoPreTokenGenerationFunction', 'Arn'] },
    });
    expect(template.Resources).not.toHaveProperty('PhosRestApi');
    expect(template.Resources).not.toHaveProperty('PhosRestApiStage');
    expect(template.Resources).not.toHaveProperty('PhosCognitoAuthorizer');
    expect(template.Resources).not.toHaveProperty('PhosApiExecutionLogGroup');
    expect(template.Resources).not.toHaveProperty('PhosApiGatewayCloudWatchRole');
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.route_logical_id]).toMatchObject({
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          AuthorizationType: 'JWT',
          AuthorizerId: { Ref: 'PhosJwtAuthorizer' },
          AuthorizationScopes: route.required_scopes,
        },
      });
      expect(template.Resources[binding.integration_logical_id]).toMatchObject({
        Type: 'AWS::ApiGatewayV2::Integration',
        Properties: {
          IntegrationType: 'AWS_PROXY',
          PayloadFormatVersion: '2.0',
        },
      });
      const functionName = readSub(
        template.Resources[binding.function_logical_id].Properties.FunctionName,
      );
      expect(functionName).toMatch(/^phos-\$\{StageName\}-[a-z0-9]+-[a-z0-9]{6}$/);
      expect(functionName.replace('${StageName}', 'abcdefghijklmnop').length).toBeLessThanOrEqual(
        64,
      );
      expect(template.Resources[binding.function_logical_id]).toMatchObject({
        Type: 'AWS::Lambda::Function',
        DependsOn: binding.log_group_logical_id,
        Properties: {
          FunctionName: { 'Fn::Sub': functionName },
          Role: { 'Fn::GetAtt': [binding.role_logical_id, 'Arn'] },
          Environment: {
            Variables: {
              PHOS_SECURITY_EVENT_TABLE_NAME: { Ref: 'PhosSecurityEventTableName' },
              PHOS_SECURITY_EVENTS_DYNAMO: '1',
              NODE_ENV: 'production',
            },
          },
        },
      });
      const policies = template.Resources[binding.role_logical_id].Properties.Policies as Array<{
        PolicyDocument: { Statement: Array<{ Action: string[]; Resource: unknown }> };
      }>;
      const logStatements = policies[0].PolicyDocument.Statement.filter((statement) =>
        statement.Action.some((action) => action.startsWith('logs:')),
      );
      expect(template.Resources[binding.role_logical_id]).toMatchObject({
        Type: 'AWS::IAM::Role',
        Properties: {
          Policies: [
            {
              PolicyDocument: {
                Statement: expect.arrayContaining([
                  expect.objectContaining({
                    Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: {
                      'Fn::Sub': `arn:aws:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/${functionName}:*`,
                    },
                  }),
                  expect.objectContaining({
                    Action: expect.arrayContaining(['xray:PutTraceSegments']),
                  }),
                ]),
              },
            },
          ],
        },
      });
      expect(logStatements).toEqual([
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: {
            'Fn::Sub': `arn:aws:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/${functionName}:*`,
          },
        },
      ]);
      expect(template.Resources[binding.log_group_logical_id]).toMatchObject({
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: {
            'Fn::Sub': `/aws/lambda/${functionName}`,
          },
          RetentionInDays: 365,
        },
      });
      const roleJson = JSON.stringify(template.Resources[binding.role_logical_id]);
      expect(roleJson).not.toContain('logs:CreateLogGroup');
      expect(roleJson).not.toContain('/aws/lambda/*');
      expect(roleJson).not.toContain('"logs:*"');
      expect(logStatements[0]?.Resource).not.toBe('*');
    }
    expect(template.Parameters.StageName).toMatchObject({
      Default: 'prod',
      MinLength: 1,
      MaxLength: 16,
      AllowedPattern: '^[A-Za-z0-9-]+$',
    });
    expect(template.Parameters.PhosAuroraDatabaseSecretArn).toMatchObject({
      Type: 'String',
      AllowedPattern: '^arn:aws:secretsmanager:[A-Za-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$',
    });
    expect(template.Parameters).not.toHaveProperty('PhosAuroraDatabaseUrl');
    expect(JSON.stringify(template)).not.toContain('PHOS_AURORA_DATABASE_URL');
    expect(template.Resources.PhosCoreDynamoDbTable).toMatchObject({
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: { Ref: PHOS_DYNAMODB_TABLE_CONTRACT.table_name_parameter },
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: expect.arrayContaining([
          expect.objectContaining({ IndexName: 'GSI1' }),
          expect.objectContaining({
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({ IndexName: 'GSI3' }),
          expect.objectContaining({ IndexName: 'GSI4' }),
          expect.objectContaining({ IndexName: 'GSI5' }),
          expect.objectContaining({ IndexName: 'GSI6' }),
          expect.objectContaining({ IndexName: 'GSI7' }),
          expect.objectContaining({ IndexName: 'GSI8' }),
        ]),
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
          KMSMasterKeyId: { Ref: 'PhosDynamoDbKmsKeyArn' },
        },
      },
    });
    expect(template.Resources.PhosSecurityEventTable).toMatchObject({
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: { Ref: 'PhosSecurityEventTableName' },
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
          KMSMasterKeyId: { Ref: 'PhosDynamoDbKmsKeyArn' },
        },
      },
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
        BucketEncryption: {
          ServerSideEncryptionConfiguration: expect.arrayContaining([
            expect.objectContaining({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
                KMSMasterKeyID: { Ref: 'PhosEvidenceKmsKeyArn' },
              },
              BucketKeyEnabled: true,
            }),
          ]),
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
        LifecycleConfiguration: {
          Rules: expect.arrayContaining([
            expect.objectContaining({
              Id: 'ExpireUnverifiedEvidenceObjects',
              Prefix: 'tenants/',
              TagFilters: [
                { Key: 'phos-object-class', Value: 'evidence' },
                { Key: 'phos-upload-status', Value: 'PRESIGNED' },
              ],
              ExpirationInDays: 1,
            }),
          ]),
        },
        CorsConfiguration: {
          CorsRules: [
            expect.objectContaining({
              AllowedMethods: ['PUT'],
              AllowedOrigins: [{ Ref: 'PhosEvidenceUploadAllowedOrigin' }],
              AllowedHeaders: expect.arrayContaining([
                'x-amz-server-side-encryption',
                'x-amz-server-side-encryption-aws-kms-key-id',
                'x-amz-tagging',
              ]),
            }),
          ],
        },
      },
    });
    expect(JSON.stringify(template.Resources.PhosEvidenceBucket)).not.toContain(
      '"AllowedOrigins":["*"]',
    );
    expect(JSON.stringify(template.Resources.PhosEvidenceBucket)).not.toContain('AES256');
    expect(template.Resources.PhosEvidenceBucketPolicy).toMatchObject({
      Type: 'AWS::S3::BucketPolicy',
      Properties: {
        PolicyDocument: {
          Statement: expect.arrayContaining([
            expect.objectContaining({
              Sid: 'DenyInsecureTransport',
              Effect: 'Deny',
              Action: 's3:*',
              Condition: {
                Bool: {
                  'aws:SecureTransport': 'false',
                },
              },
            }),
            expect.objectContaining({
              Sid: 'DenyEvidenceUploadsWithoutSseKms',
              Action: 's3:PutObject',
              Condition: {
                StringNotEquals: {
                  's3:x-amz-server-side-encryption': 'aws:kms',
                },
              },
            }),
            expect.objectContaining({
              Sid: 'DenyEvidenceUploadsWithWrongKmsKey',
              Action: 's3:PutObject',
              Condition: {
                StringNotEquals: {
                  's3:x-amz-server-side-encryption-aws-kms-key-id': {
                    Ref: 'PhosEvidenceKmsKeyArn',
                  },
                },
              },
            }),
            expect.objectContaining({
              Sid: 'DenyEvidenceUploadsWithoutEvidenceObjectClassTag',
              Action: 's3:PutObject',
              Condition: {
                StringNotEquals: {
                  's3:RequestObjectTag/phos-object-class': 'evidence',
                },
              },
            }),
            expect.objectContaining({
              Sid: 'DenyEvidenceUploadsWithoutPresignedStatusTag',
              Action: 's3:PutObject',
              Condition: {
                StringNotEquals: {
                  's3:RequestObjectTag/phos-upload-status': 'PRESIGNED',
                },
              },
            }),
          ]),
        },
      },
    });
    expect(template.Parameters.PhosDynamoDbTableName).toMatchObject({
      Default: 'phos_core',
      AllowedPattern: '^phos_core$',
    });
    expect(template.Parameters.PhosEvidenceUploadAllowedOrigin).toMatchObject({
      Type: 'String',
      AllowedPattern: '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$',
    });
    expect(template.Resources).not.toHaveProperty('PhosLambdaExecutionRole');
    const evidenceBinding = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find((route) => route.route_key === 'POST /evidence/presign-upload')!,
    );
    const visitStepBinding = bindPhosApiRouteForDeployment(
      PHOS_API_ROUTES.find(
        (route) => route.route_key === 'POST /visit-packets/{packet_id}/visit-steps/{step}',
      )!,
    );
    expect(JSON.stringify(template.Resources.PhosGETCapacityFunctionRole)).not.toContain(
      'dynamodb:TransactWriteItems',
    );
    expect(JSON.stringify(template.Resources.PhosGETCapacityFunctionRole)).not.toContain(
      's3:PutObject',
    );
    expect(JSON.stringify(template.Resources.PhosGETCapacityFunctionRole)).not.toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources.PhosGETCapacityFunctionRole)).not.toContain(
      's3:DeleteObjectVersion',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).toContain(
      's3:PutObject',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).toContain(
      'kms:ViaService',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).toContain(
      'kms:EncryptionContext:aws:s3:arn',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).not.toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[evidenceBinding.role_logical_id])).not.toContain(
      's3:DeleteObjectVersion',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      's3:GetObject',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      's3:DeleteObjectVersion',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      'kms:ViaService',
    );
    expect(JSON.stringify(template.Resources[visitStepBinding.role_logical_id])).toContain(
      'kms:EncryptionContext:aws:s3:arn',
    );
  });

  it('keeps every P0 CloudWatch metric from the final spec in the observability contract', () => {
    expect([...P0_REQUIRED_METRIC_NAMES].sort()).toEqual(
      [
        'ActionLatencyMs',
        'ActionGuardFailedCount',
        'TenantBoundaryRejectedCount',
        'CrossTenantAttemptCount',
        'VisitCompleteGuardBlockedCount',
        'EvidenceUploadFailedCount',
        'OfflineSyncConflictCount',
        'HandoffReturnedCount',
        'ReportSendFailedCount',
      ].sort(),
    );
  });

  it('keeps every P0 backend metric represented in the CloudWatch alarm baseline', () => {
    const alarmsConfig = JSON.parse(
      readFileSync(join(repoRoot, 'tools/infra/cloudwatch-alarms.json'), 'utf8'),
    ) as {
      alarms: Array<{ metric: string; namespace: string; threshold: number }>;
    };
    const backendAlarmMetrics = new Set(
      alarmsConfig.alarms
        .filter((alarm) => alarm.namespace === 'PHOS/Backend')
        .map((alarm) => alarm.metric),
    );

    for (const metricName of P0_REQUIRED_METRIC_NAMES) {
      expect(backendAlarmMetrics.has(metricName), metricName).toBe(true);
    }
    for (const alarm of alarmsConfig.alarms.filter((entry) => entry.namespace === 'PHOS/Backend')) {
      expect(alarm.threshold, alarm.metric).toBeGreaterThan(0);
    }
  });

  it('keeps CloudWatch metric logs correlated and X-Ray annotation adapter wired', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'ActionGuardFailedCount',
      value: 1,
      unit: 'Count',
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      action_code: ActionCode.COMPLETE_VISIT,
      error_code: 'ACTION_GUARD_FAILED',
    });
    const lambdaObservability = readRelative('src/phos/backend/lambda-observability.ts');

    expect(metric).toMatchObject({
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
    });
    expect(metric._aws.CloudWatchMetrics[0].Dimensions.flat()).not.toEqual(
      expect.arrayContaining(['tenant_id', 'user_id', 'request_id', 'correlation_id']),
    );
    expect(lambdaObservability).toContain('aws-xray-sdk-core');
    expect(lambdaObservability).toContain('createXRayTraceAnnotationSink');
    expect(lambdaObservability).toContain('addAnnotation');
  });

  it('does not keep obsolete PH-OS deployment/status concepts after the Lambda route manifest change', () => {
    const forbiddenMarkers = [
      ['PHOS_IMPLEMENTED', '_API_ROUTES'].join(''),
      ['PhosApiRoute', 'Status'].join(''),
      ['route.', 'status'].join(''),
      ['status !== ', "'IMPLEMENTED'"].join(''),
      ['PLAN', 'NED'].join(''),
      ['Planned', 'View'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const marker of forbiddenMarkers) {
        expect(content, relativePath).not.toContain(marker);
      }
    }
  });

  it('does not keep unused helper exports left behind by PH-OS route/client consolidation', () => {
    const obsoleteSymbols = [
      ['PhosApiError', 'Status'].join(''),
      ['handoffUrgency', 'Rank'].join(''),
      ['assigneeGsi', 'Sk'].join(''),
      ['patientGsi', 'Sk'].join(''),
      ['PhosTag', 'Label'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const symbol of obsoleteSymbols) {
        expect(content, relativePath).not.toContain(symbol);
      }
    }
  });

  it('keeps PH-OS UI and app code isolated from legacy Next API route calls', () => {
    const forbiddenApiPatterns = [
      /fetch\(\s*['"]\/api\//,
      /['"]\/api\/phos/,
      /baseUrl:\s*['"]\/api/,
    ];

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root)) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenApiPatterns) {
          expect(content, relativePath).not.toMatch(pattern);
        }
      }
    }
  });

  it('keeps PH-OS app, UI, and API client code away from server-side business data access', () => {
    const clientBoundaryRoots = [
      join(canonicalRoot, 'api'),
      join(canonicalRoot, 'ui'),
      phosAppRoot,
    ];
    const forbiddenServerSideAccessPatterns = [
      /from ['"]@\/phos\/backend(?:\/|['"])/,
      /from ['"]@\/lib\/db(?:\/|['"])/,
      /from ['"]@aws-sdk\//,
      /from ['"]@prisma\/client['"]/,
      /import\(\s*['"]@\/phos\/backend(?:\/|['"])/,
      /import\(\s*['"]@\/lib\/db(?:\/|['"])/,
      /import\(\s*['"]@aws-sdk\//,
      /import\(\s*['"]@prisma\/client['"]\s*\)/,
      /require\(\s*['"]@\/phos\/backend(?:\/|['"])/,
      /require\(\s*['"]@\/lib\/db(?:\/|['"])/,
      /require\(\s*['"]@aws-sdk\//,
      /require\(\s*['"]@prisma\/client['"]\s*\)/,
      /\bprisma\./,
      /\bnew\s+PrismaClient\b/,
      /\b(?:S3Client|DynamoDBClient|DynamoDBDocumentClient)\b/,
      /\bprocess\.env\.PHOS_[A-Z0-9_]+\b/,
      /\bprocess\.env\.DATABASE_URL\b/,
      /['"]use server['"]/,
    ];

    for (const root of clientBoundaryRoots) {
      for (const file of listFiles(root).filter((path) => /\.(?:ts|tsx)$/.test(path))) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenServerSideAccessPatterns) {
          expect(content, relativePath).not.toMatch(pattern);
        }
      }
    }
  });

  it('keeps final no-go UI logic outside presentation components', () => {
    const uiFiles = listFiles(join(canonicalRoot, 'ui')).filter((file) => file.endsWith('.tsx'));
    const forbiddenLogicPatterns = [
      /ACTION_TRANSITION_MATRIX/,
      /assertRouteAccess/,
      /client_version\s*[+<>=-]/,
      /blocking_unsynced_count\s*[<>=]/,
      /applicable_steps\s*=\s*\[/,
    ];

    for (const file of uiFiles) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenLogicPatterns) {
        expect(content, relativePath).not.toMatch(pattern);
      }
    }
  });

  it('keeps PH-OS feedback colors on design tokens instead of direct Tailwind color classes', () => {
    const feedbackClassPattern =
      /\b(?:border|bg|text)-(?:red|amber|emerald|sky)(?:-\d{2,3})?(?:\/\d{2,3})?\b/;

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root).filter((path) => path.endsWith('.tsx'))) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        expect(content, relativePath).not.toMatch(feedbackClassPattern);
      }
    }
  });

  it('keeps refactoring debt and legacy API isolation documented for PR review', () => {
    const doc = readRelative('docs/phos-legacy-api-isolation.md');

    expect(doc).toContain('PH-OS v1.1 business APIs');
    expect(doc).toContain('Current Legacy Next API Debt');
    expect(doc).toContain('/api/handoff-board');
    expect(doc).toContain('/api/care-reports');
    expect(doc).toContain('/api/billing-candidates');
  });

  it('keeps stale-version and guard-failure behavior non-optimistic in the action hook', () => {
    const hook = readRelative('src/phos/api/usePhosAction.ts');
    const singleLineHook = hook.replace(/\n/g, ' ');

    expect(hook).toMatch(/error\.status === 422/);
    expect(hook).toMatch(/ActionPhase\.GUARD_FAILED/);
    expect(hook).toMatch(/error\.status === 409/);
    expect(hook).toMatch(/ActionPhase\.CONFLICT/);
    expect(singleLineHook).not.toMatch(/setState\(\{\s*phase:\s*ActionPhase\.SUCCEEDED[^}]*catch/);
  });

  it('keeps toast feedback paired with inline errors and duplicate debounce evidence', () => {
    expectEvidence('src/phos/ui/feedback/PhosToastRegion.test.tsx', [
      /debounces duplicate toast messages/,
      /appendPhosToast/,
      /PH-OS toast notifications/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /renders successful action toasts/,
      /renders report delivery reply failures both inline and as a toast/,
      /getAllByText/,
      /PH-OS toast notifications/,
    ]);
  });

  it('keeps reason-required actions executable only with UI-provided reason codes', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /requires reason_code before executing reason-required actions/,
      /reason_required/,
      /PHOTO_INSUFFICIENT/,
      /getAttribute\('disabled'\)/,
      /getAttribute\('aria-disabled'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /sends workspace reason input for reason-required actions/,
      /reason_code: 'PHOTO_INSUFFICIENT'/,
      /reason_note: '写真が不鮮明です。'/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /clears stale reason input when the selected card action changes/,
      /カードをキャンセルする（実行不可）/,
    ]);
  });

  it('keeps Workspace deep links, opened card tabs, and focus return covered', () => {
    expectEvidence('src/app/(phos)/board/page.tsx', [
      /searchParams/,
      /initialSelectedCardId/,
      /<BoardClient/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /opens a deep-linked card from the server-provided initial card id/,
      /syncs selected card state when the server-provided card query changes/,
      /opens a deep-linked card from the current URL/,
      /returns focus to the board root when a deep-linked source card is not in the current list/,
      /keeps opened card tabs and switches selected cards/,
      /returns focus to the source tile/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /OpenedCardTabs/,
      /delegates card switching/,
      /aria-pressed/,
      /closes on Escape/,
    ]);
  });

  it('keeps Source Drawer as a focus-returning sheet with source kind copy', () => {
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.tsx', [
      /SheetContent/,
      /side="right"/,
      /triggerRef\.current\?\.focus/,
    ]);
    expectEvidence('src/phos/ui/source/SourceRefList.tsx', [
      /PhosSourceRefKindLabel/,
      /safeSourceHref/,
      /!normalized\.startsWith\('\/\/'\)/,
      /parsed\.protocol === 'https:'/,
    ]);
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.test.tsx', [
      /keeps focus inside the source drawer/,
      /getByRole\('dialog'/,
      /queryByText\('rx_1'\)/,
      /\/\/evil\.example\/source/,
      /data:text\/html/,
      /fireEvent\.keyDown\(document, \{ key: 'Tab' \}\)/,
      /drawer\.contains\(document\.activeElement\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
  });

  it('keeps PharmacistBrief rendering copy-driven, source-backed, and action-safe', () => {
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.tsx', [
      /PhosPharmacistBriefCopy/,
      /PhosClinicalSignalCodeLabel/,
      /PhosDecisionReasonLabel/,
      /PhosCommunicationIntentLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosClaimCandidateStatusLabel/,
      /SourceRefList/,
      /fieldset/,
      /data-enabled/,
      /unavailableAriaField/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /PharmacistBriefPanel/,
      /detail\.pharmacist_brief/,
    ]);
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('DOSE_INCREASE'\)/,
      /queryByText\('RESIDUAL_ADJUSTMENT'\)/,
      /queryByText\('ASK_PRESCRIBER'\)/,
      /queryByText\('MISSING_EVIDENCE'\)/,
      /hasAttribute\('disabled'\)/,
      /toHaveBeenCalledWith\('card_1', ActionCode\.CREATE_REPORT_DRAFT\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /pharmacist brief details/,
      /getByRole\('heading', \{ name: '薬剤師判断' \}\)/,
      /queryByText\('ADR_SUSPECT'\)/,
    ]);
  });

  it('keeps queue source ref displays on the shared safe source component', () => {
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.test.tsx', [
      /getAllByText\('写真・証跡'\)/,
      /queryByText\('EVIDENCE_FILE'\)/,
      /queryByText\('report_1'\)/,
    ]);
  });

  it('keeps SupportBrief and returned handoff displays clerk-safe and copy-driven', () => {
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.tsx', [
      /PhosSupportBriefCopy/,
      /PhosSupportTaskCodeLabel/,
      /PhosDeliveryMethodLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosDecisionReasonLabel/,
      /SourceRefList/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /SupportBriefPanel/,
      /detail\.support_brief/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.tsx', [
      /PhosHandoffReturnReasonLabel/,
      /RETURNED_DETAIL_PREFIX/,
    ]);
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('CONTACT_SETUP'\)/,
      /queryByText\('DIFF_REVIEW'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
      /queryByText\('phone'\)/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.test.tsx', [
      /情報の追加が必要です/,
      /追加すること/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
  });

  it('keeps Handoff composer and return UI structured instead of raw-code free text', () => {
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [
      /PhosHandoffCreateReasonLabel/,
      /PhosHandoffPanelCopy/,
      /PhosHandoffReturnReasonLabel/,
      /createRequestedActions/,
      /REQUESTED_ACTION_LABEL/,
      /RETURN_REASON_LABEL/,
      /<select/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /希望対応/,
      /確認のみ/,
      /queryByText\('DIFF_REVIEW'\)/,
      /queryByText\('REPORT_TEXT'\)/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /requested_action: input\.requested_action/,
    ]);
  });

  it('keeps standalone pharmacist Handoff Queue actionable after review opens', () => {
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [
      /HandoffStatus\.IN_REVIEW/,
      /PhosHandoffReturnReasonLabel/,
      /PhosHandoffPanelCopy\.RESOLVE_ARIA/,
      /onResolve/,
      /onReturn/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /keeps IN_REVIEW handoffs in the pharmacist queue/,
      /returns IN_REVIEW handoffs with structured reason copy/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /resolves pharmacist queue handoffs after opening review without selected card detail/,
      /client_version: 2/,
    ]);
  });

  it('keeps VisitMode stepper state labels explicit for field use', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /PhosVisitStepStateLabel/,
      /stepStateLabel/,
      /last_opened_step/,
      /NOT_STARTED/,
      /IN_PROGRESS/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /not-started, in-progress, completed, or optional/,
      /入力中/,
      /未入力/,
      /任意/,
    ]);
  });

  it('keeps VisitMode footer navigation and draft-save from completing incomplete steps', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /PhosVisitFooterCopy/,
      /PREVIOUS/,
      /SAVE_DRAFT/,
      /NEXT/,
      /canSyncDraft/,
      /activeStepCompleted/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /handleSaveVisitDraft/,
      /step === VisitStep\.ARRIVAL_CONFIRM/,
      /onSaveVisitDraft/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /does not submit VisitMode draft save for an incomplete current step/,
      /submits VisitMode draft save only for completed non-arrival steps/,
    ]);
  });

  it('keeps Capacity Dashboard chart usage scoped with a table fallback and role gate', () => {
    expectEvidence('src/phos/ui/capacity/CapacityDashboard.tsx', [
      /from 'recharts'/,
      /BarChart/,
      /Capacity Dashboard table fallback/,
      /canView/,
      /管理薬剤師または管理者のみ確認できます/,
    ]);
    expectEvidence('src/phos/ui/capacity/CapacityDashboard.test.tsx', [
      /Recharts charts, and table fallback/,
      /role gate/,
    ]);
    expectEvidence('src/phos/ui/capacity/CapacityDashboardClient.tsx', [
      /getCapacity/,
      /sessionHasCapacityRole/,
      /CapacityScope\.PHARMACY/,
    ]);
    expectEvidence('src/app/(phos)/capacity/page.tsx', [
      /CapacityDashboardClient/,
      /NEXT_PUBLIC_PHOS_API_BASE_URL/,
    ]);
  });

  it('keeps SEND_REPORT behind an explicit confirmation surface', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.tsx', [
      /requiresSendConfirmation/,
      /ActionCode\.SEND_REPORT/,
      /送付前確認/,
      /送付後は取り消せません/,
      /onExecute\(cardId, nextAction\.code, executeReason\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /requires explicit confirmation before executing SEND_REPORT/,
      /expect\(onExecute\)\.not\.toHaveBeenCalled/,
      /送付する/,
    ]);
  });

  it('keeps Report Composer as a structured recipient, template, source, and approval surface', () => {
    expectEvidence('src/phos/ui/report/ReportComposer.tsx', [
      /PhosReportComposerCopy/,
      /PhosReportComposerTemplateLabel/,
      /role="tablist"/,
      /textarea/,
      /SourceRefList/,
      /APPROVAL_REQUIRED/,
      /data-enabled/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.tsx', [
      /ReportComposer/,
      /buildReportComposerView/,
      /detail\.support_brief\?\.delivery_targets/,
      /detail\.pharmacist_brief\?\.communication_recommendations/,
    ]);
    expectEvidence('src/phos/ui/report/ReportComposer.test.tsx', [
      /送付先準備済み/,
      /送付先未設定/,
      /薬剤師承認/,
      /送付前に薬剤師承認が必要です/,
      /queryByText\('PREVIOUS_VISIT'\)/,
      /getAttribute\('disabled'\)/,
    ]);
  });

  it('keeps the existing /reports route wired to PH-OS report delivery state without a competing route group page', () => {
    expectEvidence('src/app/(dashboard)/reports/page.tsx', [
      /PhosReportsPageClient/,
      /NEXT_PUBLIC_PHOS_API_BASE_URL/,
    ]);
    expectEvidence('src/phos/ui/report/ReportsPageClient.tsx', [
      /getReportDeliveries\(\{ status: ReportDeliveryStatus\.WAITING_REPLY \}\)/,
      /getReportDeliveries\(\{ status: ReportDeliveryStatus\.ACTION_REQUIRED \}\)/,
      /router\.push\(`\/board\?card=\$\{encodeURIComponent\(cardId\)\}`\)/,
      /registerReportReply/,
      /markReportActionDone/,
    ]);
    expectEvidence('src/phos/ui/report/ReportsPageClient.test.tsx', [
      /loads waiting and action-required PH-OS report deliveries/,
      /existing \/reports route back to the Board deep link/,
      /server version and idempotency/,
      /without adding a competing \/reports route/,
    ]);
    expectMissingFiles(['src/app/(phos)/reports/page.tsx']);
  });

  it('keeps Board keyboard navigation and Space primary-action behavior covered', () => {
    expectEvidence('src/phos/ui/board/CardTile.tsx', [
      /handleCardBodyKeyDown/,
      /event\.key !== ' '/,
      /onPrimaryAction\(input\.cardId, input\.nextAction\.code\)/,
      /data-phos-card-body="true"/,
    ]);
    expectEvidence('src/phos/ui/board/CardBoard.tsx', [
      /handleBoardKeyDown/,
      /event\.key !== 'j' && event\.key !== 'k'/,
      /isTextEntryTarget/,
      /focusCardBody/,
    ]);
    expectEvidence('src/phos/ui/board/CardTile.test.tsx', [
      /Space on the card body/,
      /expect\(onOpen\)\.not\.toHaveBeenCalled/,
      /does not run the Space shortcut/,
    ]);
    expectEvidence('src/phos/ui/board/CardBoard.test.tsx', [
      /moves card focus with j and k/,
      /does not hijack j or k/,
    ]);
  });

  it('keeps Workspace tab and opened-card keyboard shortcuts covered', () => {
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.tsx', [
      /tabChordOpen/,
      /event\.key === 'g'/,
      /\^\[1-9\]\$/,
      /isTextEntryTarget/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /selectAdjacentOpenedCard/,
      /event\.key !== '\[' && event\.key !== '\]'/,
      /onSelectOpenedCard\(input\.openedCards\[nextIndex\]\?\.card_id/,
      /isTextEntryTarget/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.test.tsx', [
      /g then number keyboard chord/,
      /does not hijack the g then number keyboard chord/,
      /out-of-range g then number/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /bracket keyboard shortcuts/,
      /does not switch opened cards while typing/,
    ]);
  });

  it('keeps shortcut help available from question mark without hijacking text entry', () => {
    expectEvidence('src/phos/ui/a11y/ShortcutHelpDialog.tsx', [
      /PhosShortcutHelpCopy/,
      /PhosShortcutHelpRows/,
      /DialogContent/,
      /Keyboard/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /ShortcutHelpDialog/,
      /event\.key !== '\?'/,
      /isTextEntryTarget/,
      /setShortcutHelpOpen\(true\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /opens shortcut help with question mark/,
      /does not open shortcut help with question mark while typing/,
    ]);
    expectEvidence('src/phos/ui/a11y/ShortcutHelpDialog.test.tsx', [
      /keyboard shortcut help from copy rows/,
      /delegates close through the dialog primitive/,
    ]);
  });

  it('keeps Cmd/Ctrl+Enter wired to PH-OS form save and confirmation paths', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.tsx', [
      /isConfirmShortcut/,
      /event\.metaKey \|\| event\.ctrlKey/,
      /executePrimary/,
      /confirmSend/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.tsx', [
      /isConfirmShortcut/,
      /registerReply\(delivery\)/,
      /markActionDone\(delivery\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [
      /isConfirmShortcut/,
      /submitCreate/,
      /submitReturn\(handoff\.handoff_id\)/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [
      /isConfirmShortcut/,
      /submitReturn\(handoff\.handoff_id\)/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /isConfirmShortcut/,
      /saveDraft/,
      /submitCancelReason/,
    ]);
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /without skipping confirmation/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /only after required fields are filled/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /only after reason and note are filled/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /after the note is filled/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /same draft gate/,
      /only when a reason is present/,
    ]);
  });

  it('keeps VisitMode photo evidence capture connected to the offline queue', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /accept="image\/\*"/,
      /capture="environment"/,
      /offlineOpClass === 'BLOCKING'/,
      /onCaptureEvidence/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /enqueueEvidence/,
      /sha256Hex/,
      /retryUploads\(\{ client: apiClient \}\)/,
      /setPendingEvidenceByPacket/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /queues captured VisitMode photo evidence/,
      /file: requiredFile/,
      /必須未同期 1件/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /captures required and optional photo evidence/,
      /does not show photo capture outside the evidence upload step/,
    ]);
  });

  it('keeps the PH-OS Handoff Queue route wired to API Gateway state', () => {
    expectEvidence('src/app/(phos)/handoffs/page.tsx', [
      /HandoffsPageClient/,
      /NEXT_PUBLIC_PHOS_API_BASE_URL/,
      /PH-OS Handoffs/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffsPageClient.tsx', [
      /getHandoffs\(\{ status: HandoffStatus\.OPEN, assignee: 'ME' \}\)/,
      /getHandoffs\(\{ status: HandoffStatus\.IN_REVIEW, assignee: 'ME' \}\)/,
      /router\.push\(`\/board\?card=\$\{encodeURIComponent\(cardId\)\}`\)/,
      /openHandoff/,
      /resolveHandoff/,
      /returnHandoff/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffsPageClient.test.tsx', [
      /loads OPEN and IN_REVIEW pharmacist handoffs/,
      /opens cards back on the PH-OS Board deep link/,
      /resolves IN_REVIEW handoffs/,
      /inline configuration errors/,
    ]);
  });

  it('keeps the PH-OS direct VisitMode route wired to packet API state', () => {
    expectEvidence('src/app/(phos)/visit/[packetId]/page.tsx', [
      /params: Promise<\{ packetId: string \}>/,
      /VisitModePageClient/,
      /NEXT_PUBLIC_PHOS_API_BASE_URL/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitModePageClient.tsx', [
      /getVisitMode\(packetId\)/,
      /updateVisitStep\(visit\.packet_id, step/,
      /retryUploads\(\{ client: apiClient \}\)/,
      /onCaptureEvidence=\{visit\.card_id \? handleCaptureEvidence : undefined\}/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitModePageClient.test.tsx', [
      /loads VisitMode by packet id/,
      /updates arrival outcomes/,
      /queues photo evidence only when/,
      /hides photo capture/,
    ]);
  });

  it('keeps browser-level Board to Workspace accessibility flow covered in the final E2E spec', () => {
    expectEvidence('src/phos/infra/phos-final-e2e.test.tsx', [
      /E2E-11 preserves the browser UI flow/,
      /Board to Workspace, SourceDrawer, focus return, and Space primary action/,
      /fireEvent\.click\(sourceCard\)/,
      /getByRole\('dialog', \{ name: \/患者 山田太郎\/ \}\)/,
      /getByRole\('dialog', \{ name: '参照情報' \}\)/,
      /document\.activeElement/,
      /fireEvent\.keyDown\(sourceCard, \{ key: ' ' \}\)/,
      /executeCardAction/,
    ]);
  });
});
