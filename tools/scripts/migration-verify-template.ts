/**
 * PRE-03: データマイグレーション検証フレームワーク
 *
 * 各 Phase 5 マイグレーションの pre-count check / backfill / post-integrity check を実行する。
 *
 * 使用方法:
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p01-allergy
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p04-insurance
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p06-gender
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p07-packaging
 *   pnpm tsx tools/scripts/migration-verify-template.ts --phase p08-archive
 *
 * オプション:
 *   --dry-run   SQLを実行せずにログのみ出力
 *   --rollback  backfill を逆実行（ロールバック用）
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const phase = args.find((a) => a.startsWith('--phase='))?.split('=')[1]
  ?? args[args.indexOf('--phase') + 1];
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
      SELECT COUNT(*) as count FROM patients
    `;
    const [{ count: unknownGender }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients
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
      UPDATE patients
      SET gender = 'unknown'
      WHERE gender NOT IN ('male', 'female', 'other', 'unknown')
    `;
  },

  async rollbackSql() {
    // enum → text に戻す（P-06 ロールバック）
    await prisma.$executeRaw`
      UPDATE patients SET gender = 'other' WHERE gender = 'unknown'
    `;
  },

  async postCheck() {
    const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients
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

const p01Allergy: MigrationPhase = {
  name: 'P-01: allergy_info → PatientAllergy テーブル',

  async preCheck() {
    const [{ count: totalPatients }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients
    `;
    const [{ count: withAllergy }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE allergy_info IS NOT NULL
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
      FROM patients p,
           jsonb_array_elements(p.allergy_info) AS item
      WHERE p.allergy_info IS NOT NULL
        AND jsonb_typeof(p.allergy_info) = 'array'
      ON CONFLICT DO NOTHING
    `;
  },

  async rollbackSql() {
    // patient_allergies → allergy_info Json に集約して書き戻す
    await prisma.$executeRaw`
      UPDATE patients p
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
      SELECT COUNT(*) as count FROM patients WHERE allergy_info IS NOT NULL
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
// P-04: 保険情報の構造化
// ---------------------------------------------------------------------------

const p04Insurance: MigrationPhase = {
  name: 'P-04: insurance → PatientInsurance テーブル',

  async preCheck() {
    const [{ count: total }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients
    `;
    const [{ count: withMedical }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE medical_insurance_number IS NOT NULL
    `;
    const [{ count: withCare }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE care_insurance_number IS NOT NULL
    `;
    return {
      totalPatients: Number(total),
      patientsWithMedicalInsurance: Number(withMedical),
      patientsWithCareInsurance: Number(withCare),
    };
  },

  async backfill() {
    // medical_insurance_number → patient_insurances (type: 'medical')
    await prisma.$executeRaw`
      INSERT INTO patient_insurances (id, org_id, patient_id, insurance_type, insurance_number, is_primary, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        org_id,
        id,
        'medical',
        medical_insurance_number,
        true,
        NOW(),
        NOW()
      FROM patients
      WHERE medical_insurance_number IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
    // care_insurance_number → patient_insurances (type: 'care')
    await prisma.$executeRaw`
      INSERT INTO patient_insurances (id, org_id, patient_id, insurance_type, insurance_number, is_primary, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        org_id,
        id,
        'care',
        care_insurance_number,
        true,
        NOW(),
        NOW()
      FROM patients
      WHERE care_insurance_number IS NOT NULL
      ON CONFLICT DO NOTHING
    `;
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      UPDATE patients p
      SET medical_insurance_number = pi.insurance_number
      FROM patient_insurances pi
      WHERE pi.patient_id = p.id AND pi.insurance_type = 'medical' AND pi.is_primary = true
    `;
    await prisma.$executeRaw`
      UPDATE patients p
      SET care_insurance_number = pi.insurance_number
      FROM patient_insurances pi
      WHERE pi.patient_id = p.id AND pi.insurance_type = 'care' AND pi.is_primary = true
    `;
    await prisma.$executeRaw`DROP TABLE IF EXISTS patient_insurances CASCADE`;
  },

  async postCheck() {
    const [{ count: medicalRows }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patient_insurances WHERE insurance_type = 'medical'
    `;
    const [{ count: withMedical }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE medical_insurance_number IS NOT NULL
    `;
    const ok = Number(medicalRows) >= Number(withMedical);
    return {
      ok,
      details: ok
        ? `patient_insurances に medical:${medicalRows} 件が移行済み`
        : `移行漏れあり: patients.medical_insurance_number ${withMedical} 件 vs patient_insurances.medical ${medicalRows} 件`,
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
      SELECT COUNT(*) as count FROM patients
    `;
    const [{ count: withPref }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE packaging_preferences IS NOT NULL
    `;
    return {
      totalPatients: Number(total),
      patientsWithPackagingPreferences: Number(withPref),
    };
  },

  async backfill() {
    // packaging_preferences Json の追加フィールドを patient_packaging_profiles に同期
    // (patient_packaging_profiles テーブルは既存。Phase 5 で拡張フィールド追加)
    await prisma.$executeRaw`
      INSERT INTO patient_packaging_profiles (id, org_id, patient_id, default_packaging_method, notes, created_at, updated_at)
      SELECT
        gen_random_uuid()::text,
        p.org_id,
        p.id,
        (p.packaging_preferences->>'default_method')::text,
        (p.packaging_preferences->>'notes')::text,
        NOW(),
        NOW()
      FROM patients p
      WHERE p.packaging_preferences IS NOT NULL
      ON CONFLICT (patient_id) DO UPDATE SET
        default_packaging_method = EXCLUDED.default_packaging_method,
        notes = COALESCE(EXCLUDED.notes, patient_packaging_profiles.notes),
        updated_at = NOW()
    `;
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      UPDATE patients p
      SET packaging_preferences = jsonb_build_object(
        'default_method', pp.default_packaging_method,
        'notes', pp.notes
      )
      FROM patient_packaging_profiles pp
      WHERE pp.patient_id = p.id
    `;
  },

  async postCheck() {
    const [{ count: profileCount }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patient_packaging_profiles
    `;
    const [{ count: withPref }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE packaging_preferences IS NOT NULL
    `;
    const ok = Number(profileCount) >= Number(withPref);
    return {
      ok,
      details: ok
        ? `patient_packaging_profiles に ${profileCount} 件が移行済み`
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
      SELECT COUNT(*) as count FROM patients
    `;
    // is_archived カラムが存在するか確認
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'patients' AND column_name = 'is_archived'
    `;
    return {
      totalPatients: Number(total),
      isArchivedColumnExists: columns.length > 0 ? 1 : 0,
    };
  },

  async backfill() {
    // 既存患者は全て is_archived = false（DEFAULT で設定済みのはずだが念のため）
    await prisma.$executeRaw`
      UPDATE patients SET is_archived = false WHERE is_archived IS NULL
    `;
    // CaseStatus が 'terminated' の患者をアーカイブ候補としてマーク（自動アーカイブはしない）
    // → 運用者が手動でアーカイブ化するため、backfill では何もしない
  },

  async rollbackSql() {
    await prisma.$executeRaw`
      ALTER TABLE patients DROP COLUMN IF EXISTS is_archived;
      ALTER TABLE patients DROP COLUMN IF EXISTS archived_at;
      ALTER TABLE patients DROP COLUMN IF EXISTS archive_reason;
      ALTER TABLE patients DROP COLUMN IF EXISTS archived_by;
    `;
  },

  async postCheck() {
    const [{ count: nullArchived }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM patients WHERE is_archived IS NULL
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
