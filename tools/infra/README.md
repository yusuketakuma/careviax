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
- `rds-aws-backup-template.yaml` : RDS AWS Backup vault / plan / selection / restore-testing baseline

## RDS AWS Backup

Validate the checked-in RDS backup CloudFormation template:

```bash
pnpm aws:rds-backup:template:validate
```

Also ask AWS CloudFormation to validate the template with local AWS CLI credentials:

```bash
pnpm aws:rds-backup:template:validate -- --live-aws --strict
```

The template defaults cross-region copy, Vault Lock compliance mode, and restore testing to off.
Enable them only after PHI locality, cost, and recovery-drill windows are approved.

## EventBridge Schedule Drift

Validate the checked-in schedule definition:

```bash
pnpm eventbridge-schedules:check
```

Compare against an exported normalized/AWS schedule JSON:

```bash
pnpm eventbridge-schedules:check --actual artifacts/eventbridge-schedules.actual.json
```

Compare read-only against live EventBridge Scheduler using AWS CLI credentials:

```bash
pnpm eventbridge-schedules:check --aws --group-name ph-os-jobs --region ap-northeast-1
```
