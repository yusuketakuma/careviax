import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const templatePath = join(__dirname, 'template.yaml');
const readmePath = join(__dirname, 'README.md');
const infraReadmePath = join(__dirname, '..', 'README.md');

function readFile(path: string) {
  return readFileSync(path, 'utf8');
}

describe('websocket SAM template contract', () => {
  it('defines deployable WebSocket routes and Lambda handler paths', () => {
    const body = readFile(templatePath);

    expect(body).toContain('RouteKey: $connect');
    expect(body).toContain('RouteKey: $disconnect');
    expect(body).toContain('RouteKey: $default');
    expect(body.match(/CodeUri: \.\/lambdas\//g)).toHaveLength(4);
    expect(body).toContain('Handler: authorizer/handler.handler');
    expect(body).toContain('Handler: connect/handler.handler');
    expect(body).toContain('Handler: disconnect/handler.handler');
    expect(body).toContain('Handler: sync/handler.handler');
    expect(body).toContain('authorizer/handler.ts');
    expect(body).toContain('connect/handler.ts');
    expect(body).toContain('disconnect/handler.ts');
    expect(body).toContain('sync/handler.ts');
    expect(body).toContain("IdentitySource:\n        - 'route.request.querystring.token'");
    expect(body).not.toContain('RouteKey: yjs-sync');
  });

  it('keeps API Gateway access logs token-safe', () => {
    const body = readFile(templatePath);
    const formatLine = body.split('\n').find((line) => line.trim().startsWith('Format:'));

    expect(formatLine).toBeDefined();
    expect(formatLine).toContain('$context.requestId');
    expect(formatLine).toContain('$context.routeKey');
    expect(formatLine).toContain('$context.status');
    expect(formatLine).toContain('$context.connectionId');
    expect(formatLine).not.toMatch(/query|string|token|requestOverride|requestPath/i);
  });

  it('configures throttling and disables data tracing for WebSocket routes', () => {
    const body = readFile(templatePath);

    expect(body).toContain('DefaultRouteSettings:');
    expect(body).toContain('DataTraceEnabled: false');
    expect(body).toContain('DetailedMetricsEnabled: true');
    expect(body).toContain('ThrottlingBurstLimit: !Ref WebSocketThrottlingBurstLimit');
    expect(body).toContain('ThrottlingRateLimit: !Ref WebSocketThrottlingRateLimit');
    expect(body).toContain('ReservedConcurrentExecutions: !Ref AuthorizerReservedConcurrency');
    expect(body).toContain('ReservedConcurrentExecutions: !Ref SyncReservedConcurrency');
  });

  it('uses least-privilege IAM instead of broad generated policies', () => {
    const body = readFile(templatePath);

    expect(body).not.toContain('DynamoDBCrudPolicy');
    expect(body).toContain('dynamodb:PutItem');
    expect(body).toContain('dynamodb:GetItem');
    expect(body).toContain('dynamodb:Query');
    expect(body).toContain('dynamodb:DeleteItem');
    expect(body).toContain('${ConnectionsTable.Arn}/index/room-index');
    expect(body).toContain('/POST/@connections/*');
    expect(body).not.toContain('/:*/POST/@connections/*');
    expect(body).not.toContain('${YjsWebSocketApi}/*');
  });

  it('configures the connection table TTL and room-index GSI', () => {
    const body = readFile(templatePath);

    expect(body).toContain('TableName: ph-os-yjs-connections');
    expect(body).toContain('IndexName: room-index');
    expect(body).toContain('AttributeName: ttl');
    expect(body).toContain('Enabled: true');
  });

  it('passes the same room-token secret and endpoint contracts as the Lambda code', () => {
    const body = readFile(templatePath);

    expect(body).toContain('CollaborationRoomTokenSecretArn:');
    expect(body).toContain(
      'COLLABORATION_ROOM_TOKEN_SECRET_ARN: !Ref CollaborationRoomTokenSecretArn',
    );
    expect(body).toContain('secretsmanager:GetSecretValue');
    expect(body).toContain('Resource: !Ref CollaborationRoomTokenSecretArn');
    expect(body).toContain('NODE_ENV: production');
    expect(body).not.toContain('COLLABORATION_ROOM_TOKEN_SECRET: !Ref');
    expect(body).not.toContain('AUTH_SECRET: !Ref CollaborationRoomTokenSecret');
    expect(body).toContain(
      "WEBSOCKET_API_ENDPOINT: !Sub 'https://${YjsWebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${StageName}'",
    );
  });

  it('keeps websocket documentation aligned with the current template contract', () => {
    const readme = readFile(readmePath);
    const infraReadme = readFile(infraReadmePath);

    expect(readme).toContain('$default');
    expect(readme).toContain('collaboration-room-token');
    expect(readme).toContain('COLLABORATION_ROOM_TOKEN_SECRET_ARN');
    expect(readme).toContain('ph-os-yjs-connections');
    expect(readme).not.toMatch(/CognitoAuthorizer|Cognito JWT|yjs-sync|ph_os-yjs-connections/);
    expect(readme).not.toContain('DynamoDBCrudPolicy');
    expect(readme).not.toMatch(/Lambda functions operate within VPC security groups/);
    expect(readme).not.toMatch(/CloudTrail captures API Gateway management events/);
    expect(infraReadme).toContain('websocket/template.yaml');
  });
});
