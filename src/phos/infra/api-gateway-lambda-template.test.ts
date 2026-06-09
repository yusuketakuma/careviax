import { describe, expect, it } from 'vitest';
import { PHOS_API_ROUTES } from './api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
  buildPhosApiRouteDeploymentBindings,
} from './api-gateway-lambda-template';

function resourcesByType(type: string) {
  const template = buildPhosApiGatewayLambdaTemplate();
  return Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);
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
          Role: { 'Fn::GetAtt': ['PhosLambdaExecutionRole', 'Arn'] },
          Architectures: ['arm64'],
          TracingConfig: {
            Mode: 'Active',
          },
          Environment: {
            Variables: {
              PHOS_DYNAMODB_TABLE_NAME: { Ref: 'PhosDynamoDbTableName' },
              PHOS_AURORA_DATABASE_URL: { Ref: 'PhosAuroraDatabaseUrl' },
              PHOS_EVIDENCE_BUCKET: { Ref: 'PhosEvidenceBucketName' },
              PHOS_EVIDENCE_BUCKET_NAME: { Ref: 'PhosEvidenceBucketName' },
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

  it('creates a Lambda execution role with PH-OS runtime permissions', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Resources.PhosLambdaExecutionRole).toMatchObject({
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
                  Action: expect.arrayContaining(['dynamodb:TransactWriteItems']),
                  Resource: expect.arrayContaining([
                    {
                      'Fn::Sub':
                        'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosDynamoDbTableName}',
                    },
                    {
                      'Fn::Sub':
                        'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${PhosDynamoDbTableName}/index/*',
                    },
                  ]),
                }),
                expect.objectContaining({
                  Action: expect.arrayContaining(['s3:PutObject', 's3:GetObject']),
                  Resource: {
                    'Fn::Sub': 'arn:aws:s3:::${PhosEvidenceBucketName}/tenants/*',
                  },
                }),
              ]),
            },
          },
        ],
      },
    });
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
