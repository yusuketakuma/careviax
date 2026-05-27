# Infrastructure Templates

- `aws-waf-web-acl.json` : WAF standard ruleset template
- `vpc-security-groups.json` : network / security group baseline
- `file-storage-bucket-policy.json` : S3 storage policy baseline
- `s3-kms-key-policy.json` : storage encryption key policy
- `prescription-object-lock.json` : prescription retention / object lock
- `audit-log-archive-lifecycle.json` : audit archive lifecycle
- `cloudtrail-baseline.json` : audit trail baseline
- `cloudwatch-alarms.json` : operational alerts
- `eventbridge-schedules.json` : scheduled operational jobs
- `cognito-advanced-security.json` : Cognito advanced security settings
- `rate-limit-dynamodb.json` : DynamoDB table / TTL / IAM contract for production distributed rate limiting
- `websocket/template.yaml` : API Gateway WebSocket, Lambda, and DynamoDB collaboration sync stack
