import { PHOS_DYNAMODB_TABLE_CONTRACT } from './dynamodb-table-contract';

import {
  ref,
  stableNameHash,
  sub,
  type CloudFormationResource,
} from './api-gateway-lambda-cloudformation';

export function buildPhosCoreDynamoDbTable(input: {
  dynamodbTableNameParameter: string;
  dynamodbKmsKeyArnParameter: string;
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
        SSEType: 'KMS',
        KMSMasterKeyId: ref(input.dynamodbKmsKeyArnParameter),
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

export function buildPhosSecurityEventTable(input: {
  securityEventTableNameParameter: string;
  dynamodbKmsKeyArnParameter: string;
}): CloudFormationResource {
  return {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: ref(input.securityEventTableNameParameter),
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      SSESpecification: {
        SSEEnabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: ref(input.dynamodbKmsKeyArnParameter),
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

export function buildPhosEvidenceBucket(input: {
  evidenceBucketNameParameter: string;
  evidenceKmsKeyArnParameter: string;
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
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: ref(input.evidenceKmsKeyArnParameter),
            },
            BucketKeyEnabled: true,
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
            Prefix: 'tenants/',
            TagFilters: [
              {
                Key: 'phos-object-class',
                Value: 'evidence',
              },
              {
                Key: 'phos-upload-status',
                Value: 'PRESIGNED',
              },
            ],
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
              'x-amz-server-side-encryption',
              'x-amz-server-side-encryption-aws-kms-key-id',
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

export function buildPhosEvidenceBucketPolicy(input: {
  evidenceBucketNameParameter: string;
  evidenceKmsKeyArnParameter: string;
}): CloudFormationResource {
  const bucketArn = sub(`arn:aws:s3:::\${${input.evidenceBucketNameParameter}}`);
  const objectArn = sub(`arn:aws:s3:::\${${input.evidenceBucketNameParameter}}/*`);
  const evidenceObjectArn = sub(
    `arn:aws:s3:::\${${input.evidenceBucketNameParameter}}/tenants/*/evidence/*`,
  );
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
          {
            Sid: 'DenyEvidenceUploadsWithoutSseKms',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: evidenceObjectArn,
            Condition: {
              StringNotEquals: {
                's3:x-amz-server-side-encryption': 'aws:kms',
              },
            },
          },
          {
            Sid: 'DenyEvidenceUploadsWithWrongKmsKey',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: evidenceObjectArn,
            Condition: {
              StringNotEquals: {
                's3:x-amz-server-side-encryption-aws-kms-key-id': ref(
                  input.evidenceKmsKeyArnParameter,
                ),
              },
            },
          },
          {
            Sid: 'DenyEvidenceUploadsWithoutEvidenceObjectClassTag',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: evidenceObjectArn,
            Condition: {
              StringNotEquals: {
                's3:RequestObjectTag/phos-object-class': 'evidence',
              },
            },
          },
          {
            Sid: 'DenyEvidenceUploadsWithoutPresignedStatusTag',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: evidenceObjectArn,
            Condition: {
              StringNotEquals: {
                's3:RequestObjectTag/phos-upload-status': 'PRESIGNED',
              },
            },
          },
          {
            Sid: 'DenyEvidenceUploadsWithoutTenantTag',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:PutObject',
            Resource: evidenceObjectArn,
            Condition: {
              StringNotLike: {
                's3:RequestObjectTag/phos-tenant-id': '*',
              },
            },
          },
        ],
      },
    },
  };
}

export function buildCognitoPreTokenGenerationRole(input: {
  functionLogGroupName: string;
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
          PolicyName: 'ph-os-cognito-pre-token-generation-runtime',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
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
            ],
          },
        },
      ],
    },
  };
}

export function cognitoPreTokenFunctionName(stageNameParameter: string): string {
  return `phos-\${${stageNameParameter}}-cognito-pre-token-${stableNameHash(
    'cognito-pre-token-generation',
  )}`;
}
