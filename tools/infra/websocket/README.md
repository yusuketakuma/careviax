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
  |   ?token=<collaboration-room-token>
  v
API Gateway WebSocket API (ap-northeast-1)
  |
  +-- $connect   -> Lambda Authorizer (collaboration room token validation)
  |                  -> connect-handler Lambda (store connectionId in DynamoDB)
  |
  +-- $disconnect -> disconnect-handler Lambda (remove connectionId from DynamoDB)
  |
  +-- $default   -> sync-handler Lambda (broadcast binary Yjs sync messages to room peers)
```

## SAM Template

The deployable SAM contract lives in `template.yaml`. Keep the README as narrative
guidance only; route keys, Lambda paths, IAM actions, access-log fields, DynamoDB
TTL/GSI settings, and secret wiring are validated by `template.test.ts`.

Security invariants enforced by the template:

- `$connect` uses a request authorizer with `route.request.querystring.token`.
- Binary Yjs frames route to `$default`; handlers must not require a JSON `action`.
- Access logs include request metadata only and must not include query strings or tokens.
- WebSocket routes use explicit throttling, detailed metrics, and `DataTraceEnabled: false`
  so CRDT payloads are not captured in API Gateway execution traces.
- Lambda IAM is handler-specific; broad generated DynamoDB policies are not allowed.
- `execute-api:ManageConnections` is scoped to the stage `POST @connections` resource.
- `COLLABORATION_ROOM_TOKEN_SECRET_ARN` is passed to the authorizer; the signing secret
  value is fetched from Secrets Manager at runtime and must be distinct from the
  application auth secret in production.

## DynamoDB Connection Store Schema

The SAM template creates the connection table as `ph-os-yjs-connections`.

| Attribute    | Type    | Description                                       |
| ------------ | ------- | ------------------------------------------------- |
| connectionId | S (PK)  | API Gateway WebSocket connection ID               |
| room         | S (GSI) | Verified room name (`orgId:entityType:entityId`)  |
| userId       | S       | Local user ID from the verified room token        |
| orgId        | S       | Organization ID from the verified room token      |
| entityType   | S       | Collaboration entity type from the verified token |
| entityId     | S       | Collaboration entity ID from the verified token   |
| connectedAt  | N       | Unix timestamp of connection                      |
| expiresAt    | N       | Room token expiry timestamp                       |
| ttl          | N       | DynamoDB TTL, equal to `expiresAt`                |

**GSI: room-index** -- Query all connections in a room for message broadcast.

## Lambda Authorizer Flow

1. Browser requests `POST /api/collaboration/room-token` for the target entity.
2. The application verifies organization membership and entity-level assignment before issuing a 5-minute room token.
3. Client connects with `?token=<collaboration-room-token>` query parameter.
4. Authorizer Lambda extracts and verifies the room token with the dedicated secret referenced by `COLLABORATION_ROOM_TOKEN_SECRET_ARN` and the same salt as `issueCollaborationRoomToken`, including `purpose`, `org_id`, `user_id`, `entity_type`, `entity_id`, `room`, and expiry.
5. On success: returns Allow policy with userId/orgId/room in context.
6. The connect handler stores only the verified token context; it must not trust a client-supplied room query parameter.
7. On failure: returns Deny policy (WebSocket connection rejected)

Token is passed via query string because WebSocket API does not support
Authorization headers during the upgrade handshake. The token must be scoped to
one collaboration room and must not be a general Cognito/API bearer token.

## ISMAP Compliance Notes

All services used are ISMAP-certified and deployed in ap-northeast-1 (Tokyo):

| Service         | ISMAP Status | Notes                                           |
| --------------- | ------------ | ----------------------------------------------- |
| API Gateway     | Certified    | WebSocket API with TLS 1.2+ enforcement         |
| Lambda          | Certified    | Stateless compute, no PHI persisted in function |
| DynamoDB        | Certified    | Connection metadata only (no PHI), TTL-enabled  |
| CloudWatch Logs | Certified    | Lambda execution logs, 90-day retention         |

### Data Classification

- **Connection store**: Contains connectionId, room name, userId, orgId only.
  No PHI (Protected Health Information) is stored in DynamoDB.
- **WebSocket messages**: Yjs binary sync protocol (CRDT operations). API Gateway routes these
  frames to `$default`; the sync handler must not require a JSON `action` field.
  The handler accepts base64-encoded binary frames only and rejects text frames before
  reading the connection store.
  Content is opaque binary data transiting through Lambda.
  PHI may be present in CRDT payloads -- TLS encrypts in transit.
- **Encryption at rest**: DynamoDB table uses AWS-managed encryption (default).

### Access Controls

- WebSocket connections require a valid short-lived collaboration room token
- The room token is issued only after the normal application authz and entity assignment checks pass
- Sync handlers load the sender connection record by `connectionId` and broadcast only to the stored verified room
- Client-supplied room values in query strings, paths, or message bodies must be ignored or rejected
- Deploy Lambda functions with VPC configuration only if the chosen environment needs private egress; this template does not require RDS access.
- API Gateway access logging enabled via CloudWatch
- Organization CloudTrail baseline is managed separately in `tools/infra/cloudtrail-baseline.json`.

## Local Development

Run the y-websocket server for local development:

```bash
npx y-websocket
# Starts on ws://localhost:1234 by default
```

Set `NEXT_PUBLIC_YJS_WEBSOCKET_URL=ws://localhost:1234` (default, no config needed).
