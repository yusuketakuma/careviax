import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import {
  buildCloudWatchEmbeddedMetric,
  hashTenantId,
  hashUserId,
  P0_REQUIRED_METRIC_NAMES,
} from '@/phos/backend/observability';
import { CARD_ACTION_ROUTE_ACTION_CODES } from '@/phos/backend/card-action-executor';
import { PHOS_API_ROUTES } from '../../api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
} from '../../api-gateway-lambda-template';
import { PHOS_DYNAMODB_TABLE_CONTRACT } from '../../dynamodb-table-contract';
import { repoRoot, readRelative, readSub } from './test-support';

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
      tenant_id_hash: hashTenantId('tenant_abc123'),
      user_id_hash: hashUserId('user_1'),
      request_id: 'req_1',
      correlation_id: 'corr_1',
    });
    expect(metric._aws.CloudWatchMetrics[0].Dimensions.flat()).not.toEqual(
      expect.arrayContaining([
        'tenant_id',
        'user_id',
        'tenant_id_hash',
        'user_id_hash',
        'request_id',
        'correlation_id',
      ]),
    );
    expect(JSON.stringify(metric)).not.toContain('tenant_abc123');
    expect(JSON.stringify(metric)).not.toContain('user_1');
    expect(lambdaObservability).toContain('aws-xray-sdk-core');
    expect(lambdaObservability).toContain('createXRayTraceAnnotationSink');
    expect(lambdaObservability).toContain('addAnnotation');
  });
});
