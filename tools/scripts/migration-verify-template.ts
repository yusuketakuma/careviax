/**
 * PRE-03: データマイグレーション検証フレームワーク
 *
 * 各 Phase 5 マイグレーションの pre-count check / backfill / post-integrity check を実行する。
 *
 * 使用方法:
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p01-allergy
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p03-lab-values
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p04-insurance
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p06-gender
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p07-packaging
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p08-archive
 *
 * オプション:
 *   --dry-run   preCheck(読み取りのみ)実行後に停止。変更 SQL は実行しない
 *   --rollback  backfill を逆実行（ロールバック用）
 *
 * 【2026-07-03 監査】現行 schema で実行可能なのは p03-lab-values のみ。
 * p01/p04/p06/p07/p08 は 2026-04-04 適用済み migration 時点の歴史的記録で、
 * 現行 schema では前提が失われている（詳細は docs/phase5-migration-verification-framework.md の
 * フェーズ一覧表を参照: p01=対象テーブル不存在 / p04=カラム名不一致 / p06=enum 化適用済み /
 * p07=元カラム drop 済み / p08=is_archived 不存在）。新フェーズは実 CREATE TABLE に対して検証してから追加すること。
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { LabAnalyteCode, Prisma, PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// Prisma 7 は driver adapter 必須（引数なし new PrismaClient() は初期化エラーになる）
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const phase =
  args.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? args[args.indexOf('--phase') + 1];
const isDryRun = args.includes('--dry-run');
const isRollback = args.includes('--rollback');

// ---------------------------------------------------------------------------
// フェーズ定義
// ---------------------------------------------------------------------------

type MigrationPhase = {
  name: string;
  preCheck: () => Promise<PreCheckResult>;
  backfill: () => Promise<void>;
  rollbackSql: () => Promise<void>;
  postCheck: () => Promise<PostCheckResult>;
};

type PreCheckResult = {
  totalPatients: number;
  [key: string]: number | string;
};

type PostCheckResult = {
  ok: boolean;
  details: string;
};

// ---------------------------------------------------------------------------
// P-06: Gender Enum 正規化
// ---------------------------------------------------------------------------

const p06Gender: MigrationPhase = {
  name: 'P-06: gender enum 正規化',

  async preCheck() {
    const [{ count: totalPatients }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
    `;
    const [{ count: unknownGender }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
      WHERE gender NOT IN ('male', 'female', 'other', 'unknown')
    `;
    return {
      totalPatients: Number(totalPatients),
      unknownGenderValues: Number(unknownGender),
    };
  },

  async backfill() {
    // QR 取込などで混入した未知の gender 値を 'unknown' に正規化
    await prisma.$executeRaw`
      UPDATE "Patient"
      SET gender = 'unknown'
      WHERE gender NOT IN ('male', 'female', 'other', 'unknown')
    `;
  },

  async rollbackSql() {
    // enum → text に戻す（P-06 ロールバック）
    await prisma.$executeRaw`
      UPDATE "Patient" SET gender = 'other' WHERE gender = 'unknown'
    `;
  },

  async postCheck() {
    const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
      WHERE gender NOT IN ('male', 'female', 'other', 'unknown')
    `;
    const ok = Number(count) === 0;
    return {
      ok,
      details: ok
        ? '全患者の gender が既知の値であることを確認'
        : `未知の gender 値が ${count} 件残存`,
    };
  },
};

// ---------------------------------------------------------------------------
// P-01: アレルギー情報の構造化
// ---------------------------------------------------------------------------

// BLOCKED: この phase が前提とする "PatientAllergy" (patient_allergies) テーブルは
// prisma/schema/*.prisma / prisma/migrations/*/migration.sql のどこにも存在しない
// (allergy_info は Patient.allergy_info の Json カラムのまま構造化されている。
//  prisma/migrations/20260404100300_lab_observations_allergy_structured/migration.sql 参照)。
// そのため本 phase のテーブル名は他 phase と異なり PascalCase へ機械的に置換していない
// (実在しないテーブル名を推測で作らないため)。実行前にモデル追加 or phase 自体の要否を要判断。
const p01Allergy: MigrationPhase = {
  name: 'P-01: allergy_info → PatientAllergy テーブル',

  async preCheck() {
    const [{ count: totalPatients }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
    `;
    const [{ count: withAllergy }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE allergy_info IS NOT NULL
    `;
    return {
      totalPatients: Number(totalPatients),
      patientsWithAllergy: Number(withAllergy),
    };
  },

  async backfill() {
    // allergy_info Json → patient_allergies テーブルへの展開
    // allergy_info は配列: [{ substance, reaction, severity, notes }]
    await prisma.$executeRaw`
      INSERT INTO patient_allergies (id, org_id, patient_id, substance, reaction, severity, notes, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        p.org_id,
        p.id,
        (item->>'substance')::text,
        (item->>'reaction')::text,
        COALESCE((item->>'severity')::text, 'unknown'),
        (item->>'notes')::text,
        NOW(),
        NOW()
      FROM "Patient" p,
           jsonb_array_elements(p.allergy_info) AS item
      WHERE p.allergy_info IS NOT NULL
        AND jsonb_typeof(p.allergy_info) = 'array'
      ON CONFLICT DO NOTHING
    `;
  },

  async rollbackSql() {
    // patient_allergies → allergy_info Json に集約して書き戻す
    await prisma.$executeRaw`
      UPDATE "Patient" p
      SET allergy_info = (
        SELECT jsonb_agg(
          jsonb_build_object(
            'substance', pa.substance,
            'reaction', pa.reaction,
            'severity', pa.severity,
            'notes', pa.notes
          )
        )
        FROM patient_allergies pa
        WHERE pa.patient_id = p.id
      )
      WHERE EXISTS (SELECT 1 FROM patient_allergies pa WHERE pa.patient_id = p.id)
    `;
    await prisma.$executeRaw`DROP TABLE IF EXISTS patient_allergies CASCADE`;
  },

  async postCheck() {
    // allergy_info があった患者数 ≤ patient_allergies のユニーク患者数
    const [{ count: allergyPatients }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT patient_id) as count FROM patient_allergies
    `;
    const [{ count: withAllergy }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE allergy_info IS NOT NULL
    `;
    const ok = Number(allergyPatients) >= Number(withAllergy);
    return {
      ok,
      details: ok
        ? `patient_allergies に ${allergyPatients} 患者分のデータが移行済み`
        : `移行漏れあり: allergy_info ${withAllergy} 件 vs patient_allergies ${allergyPatients} 患者`,
    };
  },
};

// ---------------------------------------------------------------------------
// P-03: 検査値 (lab_values) の構造化
// ---------------------------------------------------------------------------

// analyte コード一覧は LabAnalyteCode enum（prisma/schema/patient.prisma）から機械的に導出する。
// 手書きの固定リストにしない — enum 追加/削除時にこのフェーズも自動追従させるため。
const LAB_ANALYTE_CODES = Object.values(LabAnalyteCode);

const p03LabValues: MigrationPhase = {
  name: 'P-03: "VisitRecord".structured_soap.objective.lab_values → "PatientLabObservation" テーブル',

  async preCheck() {
    const [{ count: totalVisitRecords }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "VisitRecord"
    `;
    const [{ count: withLabValues }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "VisitRecord"
      WHERE jsonb_typeof(structured_soap -> 'objective' -> 'lab_values') = 'object'
    `;
    // 対象患者数（lab_values を含む訪問記録を持つ患者のユニーク数）
    const [{ count: totalPatients }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT patient_id) as count FROM "VisitRecord"
      WHERE jsonb_typeof(structured_soap -> 'objective' -> 'lab_values') = 'object'
    `;
    // analyte 別カウント（enum から導出したコードのみ集計、free_text 等の非 analyte キーは除外）
    const analyteCounts = await prisma.$queryRaw<Array<{ analyte_code: string; count: bigint }>>(
      Prisma.sql`
        SELECT kv.key AS analyte_code, COUNT(*)::bigint as count
        FROM "VisitRecord" vr,
             jsonb_each(vr.structured_soap -> 'objective' -> 'lab_values') AS kv(key, value)
        WHERE jsonb_typeof(vr.structured_soap -> 'objective' -> 'lab_values') = 'object'
          AND kv.key IN (${Prisma.join(LAB_ANALYTE_CODES)})
          AND jsonb_typeof(kv.value) = 'number'
        GROUP BY kv.key
        ORDER BY kv.key
      `,
    );
    const byAnalyte: Record<string, number> = {};
    for (const row of analyteCounts) {
      byAnalyte[`analyte_${row.analyte_code}`] = Number(row.count);
    }
    return {
      totalPatients: Number(totalPatients),
      totalVisitRecords: Number(totalVisitRecords),
      visitRecordsWithLabValues: Number(withLabValues),
      ...byAnalyte,
    };
  },

  async backfill() {
    // structured_soap.objective.lab_values (Json, フラットな analyte_code -> number) を
    // "PatientLabObservation" へ展開。既存の syncVisitRecordLabObservations() と同じ抽出ロジックを
    // SQL で再現し、まだ同期されていない過去分の visit_record を追いバックフィルする。
    // 二重挿入防止のため、同一 (source_visit_record_id, analyte_code, source_type='visit_record') が
    // 既に存在する行は NOT EXISTS でスキップする（一意制約が無いテーブルのため）。
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "PatientLabObservation" (
          id, org_id, patient_id, analyte_code, measured_at, value_numeric,
          source_type, source_visit_record_id, created_at, updated_at
        )
        SELECT
          gen_random_uuid()::text,
          vr.org_id,
          vr.patient_id,
          kv.key::"LabAnalyteCode",
          vr.visit_date,
          (kv.value::text)::double precision,
          'visit_record',
          vr.id,
          NOW(),
          NOW()
        FROM "VisitRecord" vr,
             jsonb_each(vr.structured_soap -> 'objective' -> 'lab_values') AS kv(key, value)
        WHERE jsonb_typeof(vr.structured_soap -> 'objective' -> 'lab_values') = 'object'
          AND kv.key IN (${Prisma.join(LAB_ANALYTE_CODES)})
          AND jsonb_typeof(kv.value) = 'number'
          AND NOT EXISTS (
            SELECT 1 FROM "PatientLabObservation" plo
            WHERE plo.source_type = 'visit_record'
              AND plo.source_visit_record_id = vr.id
              AND plo.analyte_code = kv.key::"LabAnalyteCode"
          )
        ON CONFLICT DO NOTHING
      `,
    );
  },

  async rollbackSql() {
    // 全 truncate ではなく、visit_record 由来行（source_type='visit_record'）のみ削除する。
    // manual/import 由来の検査値（薬剤師の手入力・外部連携取込）は保持対象のため巻き込まない。
    await prisma.$executeRaw`
      DELETE FROM "PatientLabObservation" WHERE source_type = 'visit_record'
    `;
  },

  async postCheck() {
    // 1) 件数一致: JSON から抽出できる analyte 件数 vs 実際に永続化された visit_record 由来件数
    const [{ count: expected }] = await prisma.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`
        SELECT COUNT(*) as count
        FROM "VisitRecord" vr,
             jsonb_each(vr.structured_soap -> 'objective' -> 'lab_values') AS kv(key, value)
        WHERE jsonb_typeof(vr.structured_soap -> 'objective' -> 'lab_values') = 'object'
          AND kv.key IN (${Prisma.join(LAB_ANALYTE_CODES)})
          AND jsonb_typeof(kv.value) = 'number'
      `,
    );
    const [{ count: actual }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientLabObservation" WHERE source_type = 'visit_record'
    `;
    // 2) NULL integrity: visit_record 由来行は value_numeric / source_visit_record_id が必須
    const [{ count: nullValueNumeric }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientLabObservation"
      WHERE source_type = 'visit_record' AND value_numeric IS NULL
    `;
    const [{ count: nullSourceRef }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientLabObservation"
      WHERE source_type = 'visit_record' AND source_visit_record_id IS NULL
    `;
    // 3) source_visit_record_id 対応: 参照先の visit_record が実在すること（FK 制約が無い列のため明示チェック）
    const [{ count: orphanedSourceRef }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientLabObservation" plo
      WHERE plo.source_type = 'visit_record'
        AND NOT EXISTS (SELECT 1 FROM "VisitRecord" vr WHERE vr.id = plo.source_visit_record_id)
    `;

    const expectedCount = Number(expected);
    const actualCount = Number(actual);
    const countMismatch = expectedCount !== actualCount;
    const ok =
      !countMismatch &&
      Number(nullValueNumeric) === 0 &&
      Number(nullSourceRef) === 0 &&
      Number(orphanedSourceRef) === 0;

    if (ok) {
      return {
        ok,
        details: `"PatientLabObservation" に visit_record 由来 ${actualCount} 件が整合（JSON抽出期待値と一致、NULL/孤立参照なし）`,
      };
    }

    const issues: string[] = [];
    if (countMismatch) {
      issues.push(`件数不一致: JSON抽出期待値 ${expectedCount} 件 vs 実データ ${actualCount} 件`);
    }
    if (Number(nullValueNumeric) > 0) {
      issues.push(`value_numeric が NULL の行が ${nullValueNumeric} 件`);
    }
    if (Number(nullSourceRef) > 0) {
      issues.push(`source_visit_record_id が NULL の行が ${nullSourceRef} 件`);
    }
    if (Number(orphanedSourceRef) > 0) {
      issues.push(
        `source_visit_record_id が実在しない visit_record を参照する行が ${orphanedSourceRef} 件`,
      );
    }
    return { ok, details: issues.join(' / ') };
  },
};

// ---------------------------------------------------------------------------
// P-04: 保険情報の構造化
// ---------------------------------------------------------------------------

const p04Insurance: MigrationPhase = {
  name: 'P-04: insurance → PatientInsurance テーブル',

  async preCheck() {
    const [{ count: total }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
    `;
    const [{ count: withMedical }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE medical_insurance_number IS NOT NULL
    `;
    const [{ count: withCare }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE care_insurance_number IS NOT NULL
    `;
    return {
      totalPatients: Number(total),
      patientsWithMedicalInsurance: Number(withMedical),
      patientsWithCareInsurance: Number(withCare),
    };
  },

  async backfill() {
    // medical_insurance_number → "PatientInsurance" (type: 'medical')
    await prisma.$executeRaw`
      INSERT INTO "PatientInsurance" (id, org_id, patient_id, insurance_type, insurance_number, is_primary, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        org_id,
        id,
        'medical',
        medical_insurance_number,
        true,
        NOW(),
        NOW()
      FROM "Patient"
      WHERE medical_insurance_number IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
    // care_insurance_number → "PatientInsurance" (type: 'care')
    await prisma.$executeRaw`
      INSERT INTO "PatientInsurance" (id, org_id, patient_id, insurance_type, insurance_number, is_primary, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        org_id,
        id,
        'care',
        care_insurance_number,
        true,
        NOW(),
        NOW()
      FROM "Patient"
      WHERE care_insurance_number IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      UPDATE "Patient" p
      SET medical_insurance_number = pi.insurance_number
      FROM "PatientInsurance" pi
      WHERE pi.patient_id = p.id AND pi.insurance_type = 'medical' AND pi.is_primary = true
    `;
    await prisma.$executeRaw`
      UPDATE "Patient" p
      SET care_insurance_number = pi.insurance_number
      FROM "PatientInsurance" pi
      WHERE pi.patient_id = p.id AND pi.insurance_type = 'care' AND pi.is_primary = true
    `;
    await prisma.$executeRaw`DROP TABLE IF EXISTS "PatientInsurance" CASCADE`;
  },

  async postCheck() {
    const [{ count: medicalRows }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientInsurance" WHERE insurance_type = 'medical'
    `;
    const [{ count: withMedical }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE medical_insurance_number IS NOT NULL
    `;
    const ok = Number(medicalRows) >= Number(withMedical);
    return {
      ok,
      details: ok
        ? `"PatientInsurance" に medical:${medicalRows} 件が移行済み`
        : `移行漏れあり: "Patient".medical_insurance_number ${withMedical} 件 vs "PatientInsurance".medical ${medicalRows} 件`,
    };
  },
};

// ---------------------------------------------------------------------------
// P-07: パッケージングプロファイル正規化
// ---------------------------------------------------------------------------

const p07Packaging: MigrationPhase = {
  name: 'P-07: packaging_preferences → 正規化',

  async preCheck() {
    const [{ count: total }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
    `;
    const [{ count: withPref }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE packaging_preferences IS NOT NULL
    `;
    return {
      totalPatients: Number(total),
      patientsWithPackagingPreferences: Number(withPref),
    };
  },

  async backfill() {
    // packaging_preferences Json の追加フィールドを "PatientPackagingProfile" に同期
    // ("PatientPackagingProfile" テーブルは既存。Phase 5 で拡張フィールド追加)
    await prisma.$executeRaw`
      INSERT INTO "PatientPackagingProfile" (id, org_id, patient_id, default_packaging_method, notes, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        p.org_id,
        p.id,
        (p.packaging_preferences->>'default_method')::text,
        (p.packaging_preferences->>'notes')::text,
        NOW(),
        NOW()
      FROM "Patient" p
      WHERE p.packaging_preferences IS NOT NULL
      ON CONFLICT (patient_id) DO UPDATE SET
        default_packaging_method = EXCLUDED.default_packaging_method,
        notes = COALESCE(EXCLUDED.notes, "PatientPackagingProfile".notes),
        updated_at = NOW()
    `;
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      UPDATE "Patient" p
      SET packaging_preferences = jsonb_build_object(
        'default_method', pp.default_packaging_method,
        'notes', pp.notes
      )
      FROM "PatientPackagingProfile" pp
      WHERE pp.patient_id = p.id
    `;
  },

  async postCheck() {
    const [{ count: profileCount }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "PatientPackagingProfile"
    `;
    const [{ count: withPref }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE packaging_preferences IS NOT NULL
    `;
    const ok = Number(profileCount) >= Number(withPref);
    return {
      ok,
      details: ok
        ? `"PatientPackagingProfile" に ${profileCount} 件が移行済み`
        : `移行漏れあり: packaging_preferences ${withPref} 件 vs profiles ${profileCount} 件`,
    };
  },
};

// ---------------------------------------------------------------------------
// P-08: アーカイブフィールド追加（backfill は初期値設定のみ）
// ---------------------------------------------------------------------------

const p08Archive: MigrationPhase = {
  name: 'P-08: is_archived フィールド初期設定',

  async preCheck() {
    const [{ count: total }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient"
    `;
    // is_archived カラムが存在するか確認
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Patient' AND column_name = 'is_archived'
    `;
    return {
      totalPatients: Number(total),
      isArchivedColumnExists: columns.length > 0 ? 1 : 0,
    };
  },

  async backfill() {
    // 既存患者は全て is_archived = false（DEFAULT で設定済みのはずだが念のため）
    await prisma.$executeRaw`
      UPDATE "Patient" SET is_archived = false WHERE is_archived IS NULL
    `;
    // CaseStatus が 'terminated' の患者をアーカイブ候補としてマーク（自動アーカイブはしない）
    // → 運用者が手動でアーカイブ化するため、backfill では何もしない
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      ALTER TABLE "Patient" DROP COLUMN IF EXISTS is_archived;
      ALTER TABLE "Patient" DROP COLUMN IF EXISTS archived_at;
      ALTER TABLE "Patient" DROP COLUMN IF EXISTS archive_reason;
      ALTER TABLE "Patient" DROP COLUMN IF EXISTS archived_by;
    `;
  },

  async postCheck() {
    const [{ count: nullArchived }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Patient" WHERE is_archived IS NULL
    `;
    const ok = Number(nullArchived) === 0;
    return {
      ok,
      details: ok
        ? '全患者の is_archived が非 NULL であることを確認'
        : `is_archived が NULL の患者が ${nullArchived} 件残存`,
    };
  },
};

// ---------------------------------------------------------------------------
// フェーズマップ
// ---------------------------------------------------------------------------

const phases: Record<string, MigrationPhase> = {
  'p01-allergy': p01Allergy,
  'p03-lab-values': p03LabValues,
  'p04-insurance': p04Insurance,
  'p06-gender': p06Gender,
  'p07-packaging': p07Packaging,
  'p08-archive': p08Archive,
};

// ---------------------------------------------------------------------------
// 実行エントリポイント
// ---------------------------------------------------------------------------

async function run() {
  if (!phase || !phases[phase]) {
    console.error(`❌ --phase が未指定または不正です。有効な値: ${Object.keys(phases).join(', ')}`);
    process.exit(1);
  }

  const migration = phases[phase];
  console.log(`\n📋 ${migration.name}`);
  if (isDryRun) console.log('🔍 DRY RUN モード（SQL は実行されません）');
  if (isRollback) console.log('⏪ ROLLBACK モード');

  // Pre-check
  console.log('\n[1/3] Pre-check ...');
  const pre = await migration.preCheck();
  console.log('  結果:', pre);

  if (isDryRun) {
    console.log('\n✅ Dry run 完了。実際の変更はありません。');
    return;
  }

  // Backfill or Rollback
  if (isRollback) {
    console.log('\n[2/3] Rollback SQL 実行中 ...');
    await migration.rollbackSql();
    console.log('  ロールバック完了');
  } else {
    console.log('\n[2/3] Backfill 実行中 ...');
    await migration.backfill();
    console.log('  バックフィル完了');
  }

  // Post-check
  console.log('\n[3/3] Post-integrity check ...');
  const post = await migration.postCheck();
  if (post.ok) {
    console.log(`  ✅ ${post.details}`);
  } else {
    console.error(`  ❌ ${post.details}`);
    process.exit(1);
  }

  console.log('\n🎉 完了\n');
}

run()
  .catch((err) => {
    console.error('❌ エラー:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
