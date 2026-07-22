import { describe, expect, it } from 'vitest';
import { PHOS_API_ROUTES } from './api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
} from './api-gateway-lambda-template';
import type { PhosDynamoDbGlobalSecondaryIndexName } from './dynamodb-table-contract';

const DYNAMO_TRANSACTION_WRITE_ACTIONS = [
  'dynamodb:ConditionCheckItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
] as const;

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

function readSub(value: unknown): string {
  expect(value).toEqual(expect.objectContaining({ 'Fn::Sub': expect.any(String) }));
  return (value as { 'Fn::Sub': string })['Fn::Sub'];
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

function coreStatementWithAction(routeKey: string, action: string) {
  return coreDynamoStatementsForRoute(routeKey).find((statement) =>
    statement.Action.includes(action),
  );
}

describe('PH-OS API Gateway/Lambda deployment template', () => {
  it('creates per-route Lambda execution roles with capability-scoped permissions and env', () => {
    const template = buildPhosApiGatewayLambdaTemplate();
    const lambdaRoleResources = PHOS_API_ROUTES.map(
      (route) => template.Resources[bindPhosApiRouteForDeployment(route).role_logical_id],
    );

    expect(template.Resources).not.toHaveProperty('PhosLambdaExecutionRole');
    expect(lambdaRoleResources).toHaveLength(PHOS_API_ROUTES.length);
    expect(template.Resources).not.toHaveProperty('PhosApiGatewayCloudWatchRole');
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      const functionName = readSub(
        template.Resources[binding.function_logical_id].Properties.FunctionName,
      );
      const policies = template.Resources[binding.role_logical_id].Properties.Policies as Array<{
        PolicyDocument: { Statement: Array<{ Action: string[]; Resource: unknown }> };
      }>;
      const logStatements = policies[0].PolicyDocument.Statement.filter((statement) =>
        statement.Action.some((action) => action.startsWith('logs:')),
      );
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
                    Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: {
                      'Fn::Sub': `arn:aws:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/${functionName}:*`,
                    },
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
      expect(logStatements).toEqual([
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: {
            'Fn::Sub': `arn:aws:logs:\${AWS::Region}:\${AWS::AccountId}:log-group:/aws/lambda/${functionName}:*`,
          },
        },
      ]);
      const roleJson = JSON.stringify(template.Resources[binding.role_logical_id]);
      expect(roleJson).not.toContain('logs:CreateLogGroup');
      expect(roleJson).not.toContain('/aws/lambda/*');
      expect(roleJson).not.toContain('"logs:*"');
      expect(logStatements[0]?.Resource).not.toBe('*');
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
      'PHOS_AURORA_DATABASE',
    );
    expect(JSON.stringify(template.Resources[capacity.role_logical_id])).not.toContain(
      'secretsmanager:GetSecretValue',
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
        PHOS_AURORA_DATABASE_SECRET_ARN: { Ref: 'PhosAuroraDatabaseSecretArn' },
      },
    });
    expect(statementWithAction('GET /fee-rules', 'secretsmanager:GetSecretValue')).toMatchObject({
      Resource: { Ref: 'PhosAuroraDatabaseSecretArn' },
    });
    expect(JSON.stringify(template.Resources[feeRules.function_logical_id])).not.toContain(
      'PHOS_DYNAMODB_TABLE_NAME',
    );
    expect(JSON.stringify(template.Resources[feeRules.function_logical_id])).not.toContain(
      'PHOS_EVIDENCE_BUCKET',
    );
    expect(JSON.stringify(template.Resources[feeRules.function_logical_id])).not.toContain(
      'PHOS_AURORA_DATABASE_URL',
    );

    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain('s3:PutObject');
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      'arn:aws:s3:::${PhosEvidenceBucketName}/tenants/*/evidence/*',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      'kms:ViaService',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      's3.${AWS::Region}.amazonaws.com',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).toContain(
      'kms:EncryptionContext:aws:s3:arn',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).not.toContain(
      's3:GetObject',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).not.toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[evidence.role_logical_id])).not.toContain(
      's3:DeleteObjectVersion',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain('s3:GetObject');
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:GetObjectTagging',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:DeleteObject',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:DeleteObjectVersion',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      's3:PutObjectTagging',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      'arn:aws:s3:::${PhosEvidenceBucketName}/tenants/*/evidence/*',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      'kms:ViaService',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).toContain(
      'kms:EncryptionContext:aws:s3:arn',
    );
    expect(JSON.stringify(template.Resources[visitStep.role_logical_id])).not.toContain(
      '"s3:PutObject"',
    );
  });

  it('grants route-specific DynamoDB core actions without broad write or index permissions', () => {
    const expected = new Map<string, readonly string[]>([
      ['GET /cards', ['dynamodb:Query']],
      ['GET /cards/{card_id}', ['dynamodb:GetItem']],
      ['POST /cards/{card_id}/actions', ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS]],
      ['GET /capacity', ['dynamodb:GetItem']],
      ['GET /claim-candidates', ['dynamodb:Query']],
      [
        'POST /claim-candidates/{candidate_id}/exclude',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      ['GET /visit-packets/{packet_id}/visit-mode', ['dynamodb:GetItem']],
      [
        'POST /visit-packets/{packet_id}/visit-steps/{step}',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      ['POST /evidence/presign-upload', ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS]],
      ['GET /handoffs', ['dynamodb:Query']],
      ['POST /handoffs', ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS]],
      [
        'POST /handoffs/{handoff_id}/resolve',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      [
        'POST /handoffs/{handoff_id}/open',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      [
        'POST /handoffs/{handoff_id}/return',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      ['GET /report-deliveries', ['dynamodb:Query']],
      [
        'POST /report-deliveries/{delivery_id}/reply',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
      [
        'POST /report-deliveries/{delivery_id}/action-done',
        ['dynamodb:GetItem', ...DYNAMO_TRANSACTION_WRITE_ACTIONS],
      ],
    ]);

    for (const route of PHOS_API_ROUTES) {
      const routeActions = allActionsForRoute(route.route_key);
      const coreActions = coreActionsForRoute(route.route_key);
      const expectedCoreActions = expected.get(route.route_key) ?? [];

      expect(coreActions.sort(), route.route_key).toEqual([...expectedCoreActions].sort());
      expect(coreActions, route.route_key).not.toContain('dynamodb:DeleteItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:BatchWriteItem');
      expect(coreActions, route.route_key).not.toContain('dynamodb:TransactWriteItems');
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
        for (const statement of coreDynamoStatementsForRoute(route.route_key)) {
          expect(statement, route.route_key).toMatchObject({
            Condition: {
              'ForAllValues:StringLike': {
                'dynamodb:LeadingKeys': 'TENANT#*',
              },
            },
          });
        }
      }
    }
  });

  it('scopes DynamoDB Query routes to index resources and mutation routes to table resources', () => {
    const expectedQueryIndexes = new Map<string, readonly PhosDynamoDbGlobalSecondaryIndexName[]>([
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
      for (const action of DYNAMO_TRANSACTION_WRITE_ACTIONS) {
        expect(coreStatementWithAction(routeKey, action), `${routeKey} ${action}`).toMatchObject({
          Resource: {
            'Fn::Sub':
              'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosDynamoDbTableName}',
          },
        });
      }
      expect(statementWithAction(routeKey, 'dynamodb:TransactWriteItems')).toBeUndefined();
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
      expect(template.Resources[binding.route_logical_id]).toMatchObject({
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          Target: { 'Fn::Sub': `integrations/\${${binding.integration_logical_id}}` },
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
