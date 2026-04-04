# Phase 5 マイグレーション直列化戦略 (PRE-02)

## 概要

Phase 5 の全スキーマ変更（P-01/P-04/P-06/P-07/P-08）は単一ブランチで直列管理する。
並列フィーチャーブランチによるマイグレーション競合を防止し、タイムスタンプ順序を事前確定する。

---

## マイグレーションタイムスタンプ順序（確定）

| 順序 | Phase | タイムスタンプ | 変更内容 |
|---|---|---|---|
| 1 | P-06 | `20260410_100000_patient_gender_enum` | `gender` を `PatientGender` enum に変更 |
| 2 | P-01 | `20260410_110000_patient_allergy_structured` | `allergy_info Json?` → `PatientAllergy` テーブル |
| 3 | P-04 | `20260410_120000_patient_insurance_structured` | `medical_insurance_number` → `PatientInsurance` テーブル |
| 4 | P-07 | `20260410_130000_patient_packaging_normalized` | `packaging_preferences Json?` → `PackagingProfile` 正規化 |
| 5 | P-08 | `20260410_140000_patient_archive` | `is_archived`, `archived_at`, `archive_reason` 追加 |

> **規則**: タイムスタンプは UTC、`YYYYMMDD_HHMMSS_<slug>` 形式。スラッグはスネークケース・英語のみ。

---

## 直列管理ルール

### ブランチ戦略

```
main
└── feature/phase5-patient-model   ← Phase 5 専用ブランチ（単一）
    ├── prisma/migrations/20260410_100000_patient_gender_enum/
    ├── prisma/migrations/20260410_110000_patient_allergy_structured/
    ├── prisma/migrations/20260410_120000_patient_insurance_structured/
    ├── prisma/migrations/20260410_130000_patient_packaging_normalized/
    └── prisma/migrations/20260410_140000_patient_archive/
```

- Phase 5 期間中、`prisma/schema/patient.prisma` の変更は `feature/phase5-patient-model` にのみ行う
- 他ブランチが `patient.prisma` を変更する場合は、Phase 5 ブランチとのマージ調整をリードエンジニアが担当

### マイグレーション競合防止ルール

1. **タイムスタンプ予約**: 上記テーブルのタイムスタンプを事前に `migration_lock.toml` に記録し、他開発者が同じタイムスタンプを使わないようにする
2. **migration 追加禁止期間**: Phase 5 ブランチが main へのマージ PR を出した後は、`patient.prisma` への新規 migration を凍結する
3. **順序変更禁止**: 上記順序は依存関係に基づく。P-06（gender enum）は他モデルが参照する可能性があるため先行させる
4. **`prisma migrate dev` 禁止**: Phase 5 期間中のローカル開発では `prisma migrate dev --create-only` を使い、SQL を手動レビュー後に適用する

### ローカル開発手順

```bash
# 新しい migration を作成する場合（SQL 自動生成のみ、適用しない）
pnpm prisma migrate dev --create-only --name <slug>

# ステージングへの適用
pnpm db:migrate

# migration の状態確認
pnpm prisma migrate status
```

---

## 各 Migration の依存関係

```
P-06 (gender enum)
  └─ 依存なし（最初に実行）

P-01 (allergy)
  └─ 依存なし（P-06 と並列可だが直列化で安全確保）

P-04 (insurance)
  └─ 依存なし

P-07 (packaging)
  └─ P-08 より前（PackagingProfile は Patient に依存、archive 後の患者も対象）

P-08 (archive)
  └─ P-07 より後（アーカイブは全フィールド移行後に追加）
```

---

## `migration_lock.toml` への記載

Phase 5 開始前に以下を追記する：

```toml
# Phase 5 reserved timestamps (DO NOT USE)
# 20260410_100000 - P-06 gender enum
# 20260410_110000 - P-01 allergy
# 20260410_120000 - P-04 insurance
# 20260410_130000 - P-07 packaging
# 20260410_140000 - P-08 archive
provider = "postgresql"
```

---

## マージ前チェックリスト

- [ ] 全 5 件の migration が上記タイムスタンプ順で `prisma/migrations/` に存在する
- [ ] `pnpm prisma migrate status` でドリフトなし
- [ ] ステージング環境で `pnpm db:migrate` が完走する
- [ ] `pnpm db:generate` で Prisma Client が型エラーなく生成される
- [ ] `pnpm build` が通る
