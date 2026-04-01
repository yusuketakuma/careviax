# I-02 — VPC / セキュリティグループ設計

## 概要

CareViaX の本番ネットワークは 2 層 VPC を基本とし、公開面とデータ面を分離する。RDS は常に private-db サブネットへ配置し、アプリケーション層または SSM Session Manager 経由でのみ到達可能とする。

## ネットワーク構成

- Public subnet: ALB, NAT Gateway
- Private app subnet: Lambda / ECS / Next.js runtime
- Private DB subnet: RDS PostgreSQL
- VPC endpoint: S3, Secrets Manager, CloudWatch Logs

実体テンプレートは [vpc-security-groups.json](/Users/yusuke/workspace/careviax/infra/vpc-security-groups.json) を SSOT とする。

## セキュリティグループ

1. `careviax-alb-sg`
2. `careviax-app-sg`
3. `careviax-rds-sg`
4. `careviax-ssm-bastion-sg`

## 必須要件

- ALB から app へのみ 3000/TCP を許可
- app から RDS へのみ 5432/TCP を許可
- RDS の public access は無効
- 管理者の DB 直接アクセスは SSM Session Manager 経由のみ
- S3 は internet egress ではなく VPC endpoint 経由

## 更新履歴

| 日付 | 更新内容 |
|---|---|
| 2026-03-31 | I-02 設計書を追加 |
