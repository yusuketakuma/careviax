# Operational Scripts

- `backup-recovery-check.ts` : バックアップ / 復旧手順の前提確認
- `check-care-report-duplicates.ts` : CareReport unique-index migration precheck
- `external-access-case-boundary-audit.ts` : legacy ExternalAccessGrant case-boundary audit/backfill
- `link-prisma-client.mjs` : Prisma client の postinstall 補助
- `perf-smoke.ts` : API performance smoke test
- `build-phos-lambda-artifact.ts` : PH-OS Lambda artifact builder for deploy proof
- `validate-phos-deploy-template.ts` : PH-OS CloudFormation template export + external validation report
- `verify-phos-backend-live-readiness.ts` : PH-OS backend live-proof readiness gate/report
- `verify-phos-cognito-token-trigger.ts` : PH-OS Cognito Pre Token Generation live proof
- `pilot-dossier.ts` : pilot launch dossier 生成
- `pilot-org-audit.ts` : pilot organization audit
- `pilot-readiness-report.ts` : pilot readiness report
- `pmda-onboarding-check.ts` : PMDA onboarding readiness check
- `uat-feedback-summary.ts` : UAT feedback summary
