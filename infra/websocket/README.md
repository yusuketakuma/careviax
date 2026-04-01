# API Gateway WebSocket API for Yjs CRDT Sync

## Overview

This directory contains the infrastructure definition for the Yjs collaborative editing
WebSocket backend, deployed as an API Gateway WebSocket API with Lambda handlers and
DynamoDB connection store.

In development, use `y-websocket` server locally (`ws://localhost:1234`).
In production, clients connect to the API Gateway WebSocket endpoint.

## Architecture

```
Client (Yjs WebsocketProvider)
  |
  | wss://xxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
  |   ?token=<cognito-jwt>&room=<entityType:entityId>
  v
API Gateway WebSocket API (ap-northeast-1)
  |
  +-- $connect   -> Lambda Authorizer (Cognito JWT validation)
  |                  -> connect-handler Lambda (store connectionId in DynamoDB)
  |
  +-- $disconnect -> disconnect-handler Lambda (remove connectionId from DynamoDB)
  |
  +-- yjs-sync   -> sync-handler Lambda (broadcast Yjs sync messages to room peers)
```

## SAM Template Structure

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        CONNECTIONS_TABLE: !Ref ConnectionsTable

Resources:
  # --- WebSocket API ---
  YjsWebSocketApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: careviax-yjs-websocket
      ProtocolType: WEBSOCKET
      RouteSelectionExpression: "$request.body.action"

  # --- Cognito JWT Authorizer ---
  CognitoAuthorizer:
    Type: AWS::ApiGatewayV2::Authorizer
    Properties:
      ApiId: !Ref YjsWebSocketApi
      AuthorizerType: REQUEST
      AuthorizerUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AuthorizerFunction.Arn}/invocations"
      IdentitySource:
        - "route.request.querystring.token"

  AuthorizerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: authorizer.handler
      CodeUri: ./lambdas/authorizer/
      Description: Validate Cognito JWT from query string token parameter
      Environment:
        Variables:
          COGNITO_USER_POOL_ID: !Ref CognitoUserPoolId
          COGNITO_CLIENT_ID: !Ref CognitoClientId

  # --- Routes ---
  ConnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref YjsWebSocketApi
      RouteKey: $connect
      AuthorizationType: CUSTOM
      AuthorizerId: !Ref CognitoAuthorizer
      Target: !Sub "integrations/${ConnectIntegration}"

  DisconnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref YjsWebSocketApi
      RouteKey: $disconnect
      Target: !Sub "integrations/${DisconnectIntegration}"

  YjsSyncRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref YjsWebSocketApi
      RouteKey: yjs-sync
      Target: !Sub "integrations/${SyncIntegration}"

  # --- Lambda Handlers ---
  ConnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: connect.handler
      CodeUri: ./lambdas/connect/
      Description: Store WebSocket connectionId and room in DynamoDB
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  DisconnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: disconnect.handler
      CodeUri: ./lambdas/disconnect/
      Description: Remove connectionId from DynamoDB on disconnect
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  SyncFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: sync.handler
      CodeUri: ./lambdas/sync/
      Description: Broadcast Yjs sync/awareness messages to room peers
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable
        - Statement:
            - Effect: Allow
              Action: execute-api:ManageConnections
              Resource: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${YjsWebSocketApi}/*"

  # --- DynamoDB Connection Store ---
  ConnectionsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: careviax-yjs-connections
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: connectionId
          AttributeType: S
        - AttributeName: room
          AttributeType: S
      KeySchema:
        - AttributeName: connectionId
          KeyType: HASH
      GlobalSecondaryIndexes:
        - IndexName: room-index
          KeySchema:
            - AttributeName: room
              KeyType: HASH
            - AttributeName: connectionId
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

Parameters:
  CognitoUserPoolId:
    Type: String
  CognitoClientId:
    Type: String
```

## DynamoDB Connection Store Schema

| Attribute      | Type   | Description                                      |
|----------------|--------|--------------------------------------------------|
| connectionId   | S (PK) | API Gateway WebSocket connection ID              |
| room           | S (GSI) | Room name (`entityType:entityId`)               |
| userId         | S      | Cognito user sub from JWT                        |
| orgId          | S      | Organization ID from JWT custom claim            |
| connectedAt    | N      | Unix timestamp of connection                     |
| ttl            | N      | DynamoDB TTL (connectedAt + 24h)                 |

**GSI: room-index** -- Query all connections in a room for message broadcast.

## Lambda Authorizer Flow

1. Client connects with `?token=<jwt>` query parameter
2. Authorizer Lambda extracts token, verifies against Cognito JWKS
3. On success: returns Allow policy with userId/orgId in context
4. On failure: returns Deny policy (WebSocket connection rejected)

Token is passed via query string because WebSocket API does not support
Authorization headers during the upgrade handshake.

## ISMAP Compliance Notes

All services used are ISMAP-certified and deployed in ap-northeast-1 (Tokyo):

| Service              | ISMAP Status | Notes                                           |
|----------------------|-------------|--------------------------------------------------|
| API Gateway          | Certified   | WebSocket API with TLS 1.2+ enforcement          |
| Lambda               | Certified   | Stateless compute, no PHI persisted in function   |
| DynamoDB             | Certified   | Connection metadata only (no PHI), TTL-enabled    |
| CloudWatch Logs      | Certified   | Lambda execution logs, 90-day retention           |

### Data Classification

- **Connection store**: Contains connectionId, room name, userId, orgId only.
  No PHI (Protected Health Information) is stored in DynamoDB.
- **WebSocket messages**: Yjs binary sync protocol (CRDT operations).
  Content is opaque binary data transiting through Lambda.
  PHI may be present in CRDT payloads -- TLS encrypts in transit.
- **Encryption at rest**: DynamoDB table uses AWS-managed encryption (default).

### Access Controls

- WebSocket connections require valid Cognito JWT
- Lambda functions operate within VPC security groups (same as RDS)
- API Gateway access logging enabled via CloudWatch
- CloudTrail captures API Gateway management events

## Local Development

Run the y-websocket server for local development:

```bash
npx y-websocket
# Starts on ws://localhost:1234 by default
```

Set `NEXT_PUBLIC_YJS_WEBSOCKET_URL=ws://localhost:1234` (default, no config needed).
