import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run prisma seed');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_SOURCE_OF_TRUTH_MATRIX = [
  {
    entity_type: 'patient_basic',
    source_of_truth: 'careviax',
    sync_direction: 'pull',
    external_system: 'receipt_computer',
    recovery_procedure:
      'レセコン再取込後に患者単位で差分照合し、Patient/Residence/ContactParty/CareCase の在宅運用属性を手動確定する',
  },
  {
    entity_type: 'prescription_original',
    source_of_truth: 'external',
    sync_direction: 'pull',
    external_system: 'receipt_computer_or_e_prescription',
    recovery_procedure:
      '原本識別子で再照合し、PrescriptionIntake と PrescriptionLine の差分を WorkflowException として解消する',
  },
  {
    entity_type: 'dispense_result',
    source_of_truth: 'external',
    sync_direction: 'push',
    external_system: 'receipt_computer',
    recovery_procedure:
      'CareViaX で保持した DispenseTask/DispenseResult/DispenseAudit を再送し、確定調剤実績との差分を再確認する',
  },
  {
    entity_type: 'carry_items',
    source_of_truth: 'careviax',
    sync_direction: 'internal',
    external_system: null,
    recovery_procedure:
      'DispenseResult・SetAudit・VisitSchedule を元に carry_items を再計算し、出発前チェックを再実行する',
  },
  {
    entity_type: 'report_delivery',
    source_of_truth: 'careviax',
    sync_direction: 'push',
    external_system: 'ses_fax_phone',
    recovery_procedure:
      'DeliveryRecord と CommunicationEvent に送達証跡を再取込し、未確認分を response_waiting として再起票する',
  },
  {
    entity_type: 'billing',
    source_of_truth: 'careviax',
    sync_direction: 'push',
    external_system: 'receipt_computer',
    recovery_procedure:
      'BillingEvidence と BillingCandidate を再生成し、提出済みレセコンデータとの差分を再送または除外理由更新で解消する',
  },
] as const;

const SEED_IDS = {
  org: 'cmnhseedorg0000amq9careviax',
  site: 'cmnhseedsite000amq9careviax',
  user: 'cmnb3swgz0008wgq9gfpgjq6r',
  patients: [
    'cmnhseedpt001amq9careviax',
    'cmnhseedpt002amq9careviax',
    'cmnhseedpt003amq9careviax',
  ],
} as const;

async function main() {
  // 組織
  const org = await prisma.organization.upsert({
    where: { id: SEED_IDS.org },
    create: {
      id: SEED_IDS.org,
      name: 'サンプル薬局',
      address: '東京都千代田区丸の内1-1-1',
    },
    update: {
      name: 'サンプル薬局',
      address: '東京都千代田区丸の内1-1-1',
    },
  });

  // 薬局サイト
  const site = await prisma.pharmacySite.upsert({
    where: { id: SEED_IDS.site },
    create: {
      id: SEED_IDS.site,
      org_id: org.id,
      name: 'サンプル薬局 本店',
      address: '東京都千代田区丸の内1-1-1',
      lat: 35.6812,
      lng: 139.7671,
    },
    update: {
      org_id: org.id,
      name: 'サンプル薬局 本店',
      address: '東京都千代田区丸の内1-1-1',
      lat: 35.6812,
      lng: 139.7671,
    },
  });

  await prisma.sourceOfTruthMatrix.deleteMany({
    where: { org_id: org.id },
  });
  await prisma.sourceOfTruthMatrix.createMany({
    data: DEFAULT_SOURCE_OF_TRUTH_MATRIX.map((entry) => ({
      org_id: org.id,
      ...entry,
    })),
  });

  // 配薬方法マスタ
  await prisma.packagingMethodMaster.deleteMany({
    where: { org_id: org.id },
  });
  await prisma.packagingMethodMaster.createMany({
    data: [
      { org_id: org.id, name: 'お薬BOX', description: '仕切り付きBOXに曜日・時間帯別に収納', icon_key: 'box', sort_order: 0, is_active: true },
      { org_id: org.id, name: 'お薬カレンダー', description: '壁掛けカレンダー型ポケットに収納', icon_key: 'calendar', sort_order: 1, is_active: true },
      { org_id: org.id, name: '一包化', description: '服用タイミングごとに自動分包', icon_key: 'pack', sort_order: 2, is_active: true },
      { org_id: org.id, name: 'ホッチキス止め', description: '分包紙をホッチキスで綴じる', icon_key: 'staple', sort_order: 3, is_active: true },
      { org_id: org.id, name: 'テープ止め', description: '分包紙をテープで綴じる', icon_key: 'tape', sort_order: 4, is_active: true },
      { org_id: org.id, name: '分包紙', description: '薬を個別分包紙に入れて提供', icon_key: 'envelope', sort_order: 5, is_active: true },
      { org_id: org.id, name: 'PTPシート', description: 'メーカー出荷時のシートのまま提供', icon_key: 'blister', sort_order: 6, is_active: true },
      { org_id: org.id, name: '液剤ボトル', description: '液剤をボトルに入れて提供', icon_key: 'bottle', sort_order: 7, is_active: true },
    ],
  });

  // ユーザー（管理者薬剤師）
  const user = await prisma.user.upsert({
    where: { id: SEED_IDS.user },
    create: {
      id: SEED_IDS.user,
      org_id: org.id,
      cognito_sub: 'demo-cognito-sub-001',
      cognito_username: 'demo@careviax.example.com',
      email: 'demo@careviax.example.com',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      account_status: 'active',
      activated_at: new Date(),
    },
    update: {
      org_id: org.id,
      cognito_sub: 'demo-cognito-sub-001',
      cognito_username: 'demo@careviax.example.com',
      email: 'demo@careviax.example.com',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      account_status: 'active',
      activated_at: new Date(),
    },
  });

  // メンバーシップ
  await prisma.membership.deleteMany({
    where: {
      user_id: user.id,
    },
  });
  await prisma.membership.create({
    data: {
      org_id: org.id,
      user_id: user.id,
      site_id: site.id,
      role: 'owner',
      can_dispense: true,
      can_audit_dispense: true,
      can_set: true,
      can_audit_set: true,
    },
  });

  // 患者サンプル
  const patients = await Promise.all([
    prisma.patient.upsert({
      where: { id: SEED_IDS.patients[0] },
      create: {
        id: SEED_IDS.patients[0],
        org_id: org.id,
        name: '佐藤 花子',
        name_kana: 'サトウ ハナコ',
        birth_date: new Date('1945-03-15'),
        gender: 'female',
        phone: '090-1234-5678',
      },
      update: {
        org_id: org.id,
        name: '佐藤 花子',
        name_kana: 'サトウ ハナコ',
        birth_date: new Date('1945-03-15'),
        gender: 'female',
        phone: '090-1234-5678',
      },
    }),
    prisma.patient.upsert({
      where: { id: SEED_IDS.patients[1] },
      create: {
        id: SEED_IDS.patients[1],
        org_id: org.id,
        name: '鈴木 一郎',
        name_kana: 'スズキ イチロウ',
        birth_date: new Date('1950-07-22'),
        gender: 'male',
        phone: '090-9876-5432',
      },
      update: {
        org_id: org.id,
        name: '鈴木 一郎',
        name_kana: 'スズキ イチロウ',
        birth_date: new Date('1950-07-22'),
        gender: 'male',
        phone: '090-9876-5432',
      },
    }),
    prisma.patient.upsert({
      where: { id: SEED_IDS.patients[2] },
      create: {
        id: SEED_IDS.patients[2],
        org_id: org.id,
        name: '田中 美智子',
        name_kana: 'タナカ ミチコ',
        birth_date: new Date('1938-11-03'),
        gender: 'female',
      },
      update: {
        org_id: org.id,
        name: '田中 美智子',
        name_kana: 'タナカ ミチコ',
        birth_date: new Date('1938-11-03'),
        gender: 'female',
      },
    }),
  ]);

  console.log('Seed data created:', {
    org: org.id,
    site: site.id,
    user: user.id,
    patients: patients.length,
    sourceOfTruthEntries: DEFAULT_SOURCE_OF_TRUTH_MATRIX.length,
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
