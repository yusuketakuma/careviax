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
    source_of_truth: 'ph-os',
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
      'PH-OS で保持した DispenseTask/DispenseResult/DispenseAudit を再送し、確定調剤実績との差分を再確認する',
  },
  {
    entity_type: 'carry_items',
    source_of_truth: 'ph-os',
    sync_direction: 'internal',
    external_system: null,
    recovery_procedure:
      'DispenseResult・SetAudit・VisitSchedule を元に carry_items を再計算し、出発前チェックを再実行する',
  },
  {
    entity_type: 'report_delivery',
    source_of_truth: 'ph-os',
    sync_direction: 'push',
    external_system: 'ses_fax_phone',
    recovery_procedure:
      'DeliveryRecord と CommunicationEvent に送達証跡を再取込し、未確認分を response_waiting として再起票する',
  },
  {
    entity_type: 'billing',
    source_of_truth: 'ph-os',
    sync_direction: 'push',
    external_system: 'receipt_computer',
    recovery_procedure:
      'BillingEvidence と BillingCandidate を再生成し、提出済みレセコンデータとの差分を再送または除外理由更新で解消する',
  },
] as const;

const SEED_IDS = {
  org: 'cmnhseedorg0000amq9ph-os',
  site: 'cmnhseedsite000amq9ph-os',
  user: 'cmnb3swgz0008wgq9gfpgjq6r',
  prescriberInstitution: 'cmnhseedinst001amq9ph-os',
  pcaPumpAvailable: 'cmnhseedpca001amq9ph-os',
  pcaPumpRented: 'cmnhseedpca002amq9ph-os',
  pcaRentalActive: 'cmnhseedrental001amq9ph-os',
  vehicleResource: 'cmnhseedveh001amq9ph-os',
  injectionEligibleDrug: 'cmnhseeddrug001amq9ph-os',
  injectionBlockedDrug: 'cmnhseeddrug002amq9ph-os',
  patients: [
    'cmnhseedpt001amq9ph-os',
    'cmnhseedpt002amq9ph-os',
    'cmnhseedpt003amq9ph-os',
    'cmnhseedpt004amq9ph-os',
    'cmnhseedpt005amq9ph-os',
  ],
  careCases: [
    'cmnhseedcase001amq9ph-os',
    'cmnhseedcase002amq9ph-os',
    'cmnhseedcase003amq9ph-os',
    'cmnhseedcase004amq9ph-os',
    'cmnhseedcase005amq9ph-os',
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

  const vehicleResource = await prisma.visitVehicleResource.upsert({
    where: {
      org_id_vehicle_code: {
        org_id: org.id,
        vehicle_code: 'VEH-SEED-001',
      },
    },
    create: {
      id: SEED_IDS.vehicleResource,
      org_id: org.id,
      site_id: site.id,
      label: 'E2E社用車A',
      vehicle_code: 'VEH-SEED-001',
      travel_mode: 'DRIVE',
      max_stops: 6,
      max_route_duration_minutes: 180,
      available: true,
      notes: 'E2E/デモ用の訪問ルート検証車両',
    },
    update: {
      site_id: site.id,
      label: 'E2E社用車A',
      travel_mode: 'DRIVE',
      max_stops: 6,
      max_route_duration_minutes: 180,
      available: true,
      notes: 'E2E/デモ用の訪問ルート検証車両',
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
      {
        org_id: org.id,
        name: 'お薬BOX',
        description: '仕切り付きBOXに曜日・時間帯別に収納',
        icon_key: 'box',
        sort_order: 0,
        is_active: true,
      },
      {
        org_id: org.id,
        name: 'お薬カレンダー',
        description: '壁掛けカレンダー型ポケットに収納',
        icon_key: 'calendar',
        sort_order: 1,
        is_active: true,
      },
      {
        org_id: org.id,
        name: '一包化',
        description: '服用タイミングごとに自動分包',
        icon_key: 'pack',
        sort_order: 2,
        is_active: true,
      },
      {
        org_id: org.id,
        name: 'ホッチキス止め',
        description: '分包紙をホッチキスで綴じる',
        icon_key: 'staple',
        sort_order: 3,
        is_active: true,
      },
      {
        org_id: org.id,
        name: 'テープ止め',
        description: '分包紙をテープで綴じる',
        icon_key: 'tape',
        sort_order: 4,
        is_active: true,
      },
      {
        org_id: org.id,
        name: '分包紙',
        description: '薬を個別分包紙に入れて提供',
        icon_key: 'envelope',
        sort_order: 5,
        is_active: true,
      },
      {
        org_id: org.id,
        name: 'PTPシート',
        description: 'メーカー出荷時のシートのまま提供',
        icon_key: 'blister',
        sort_order: 6,
        is_active: true,
      },
      {
        org_id: org.id,
        name: '液剤ボトル',
        description: '液剤をボトルに入れて提供',
        icon_key: 'bottle',
        sort_order: 7,
        is_active: true,
      },
    ],
  });

  // ユーザー（管理者薬剤師）
  const user = await prisma.user.upsert({
    where: { id: SEED_IDS.user },
    create: {
      id: SEED_IDS.user,
      org_id: org.id,
      cognito_sub: 'demo-cognito-sub-001',
      cognito_username: 'demo@ph-os.example.com',
      email: 'demo@ph-os.example.com',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      account_status: 'active',
      activated_at: new Date(),
    },
    update: {
      org_id: org.id,
      cognito_sub: 'demo-cognito-sub-001',
      cognito_username: 'demo@ph-os.example.com',
      email: 'demo@ph-os.example.com',
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
    prisma.patient.upsert({
      where: { id: SEED_IDS.patients[3] },
      create: {
        id: SEED_IDS.patients[3],
        org_id: org.id,
        name: '佐藤 介護申請',
        name_kana: 'サトウ カイゴシンセイ',
        birth_date: new Date('1942-05-14'),
        gender: 'female',
      },
      update: {
        org_id: org.id,
        name: '佐藤 介護申請',
        name_kana: 'サトウ カイゴシンセイ',
        birth_date: new Date('1942-05-14'),
        gender: 'female',
      },
    }),
    prisma.patient.upsert({
      where: { id: SEED_IDS.patients[4] },
      create: {
        id: SEED_IDS.patients[4],
        org_id: org.id,
        name: '高橋 公費二一',
        name_kana: 'タカハシ コウヒニジュウイチ',
        birth_date: new Date('1975-02-21'),
        gender: 'male',
      },
      update: {
        org_id: org.id,
        name: '高橋 公費二一',
        name_kana: 'タカハシ コウヒニジュウイチ',
        birth_date: new Date('1975-02-21'),
        gender: 'male',
      },
    }),
  ]);

  const careCases = await Promise.all(
    patients.map((patient, index) =>
      prisma.careCase.upsert({
        where: { id: SEED_IDS.careCases[index] },
        create: {
          id: SEED_IDS.careCases[index],
          org_id: org.id,
          patient_id: patient.id,
          status: 'active',
          referral_source: 'サンプル医療機関',
          referral_date: new Date('2026-06-01'),
          start_date: new Date('2026-06-01'),
          primary_pharmacist_id: user.id,
          required_visit_support: {
            home_visit_intake: {
              care_level:
                index === 0 ? 'care_2' : index === 1 || index === 3 ? 'applying' : 'care_1',
            },
          },
          notes: 'E2E/デモ用ケース',
        },
        update: {
          org_id: org.id,
          patient_id: patient.id,
          status: 'active',
          referral_source: 'サンプル医療機関',
          referral_date: new Date('2026-06-01'),
          start_date: new Date('2026-06-01'),
          primary_pharmacist_id: user.id,
          required_visit_support: {
            home_visit_intake: {
              care_level:
                index === 0 ? 'care_2' : index === 1 || index === 3 ? 'applying' : 'care_1',
            },
          },
          notes: 'E2E/デモ用ケース',
        },
      }),
    ),
  );

  await Promise.all([
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinsmed001amq9ph-os' },
      create: {
        id: 'cmnhseedinsmed001amq9ph-os',
        org_id: org.id,
        patient_id: patients[0].id,
        insurance_type: 'medical',
        application_status: 'confirmed',
        insurer_number: '06130001',
        symbol: '在宅',
        number: '000001',
        copay_ratio: 10,
        valid_from: new Date('2026-04-01'),
        is_active: true,
      },
      update: {
        org_id: org.id,
        patient_id: patients[0].id,
        insurance_type: 'medical',
        application_status: 'confirmed',
        insurer_number: '06130001',
        symbol: '在宅',
        number: '000001',
        copay_ratio: 10,
        valid_from: new Date('2026-04-01'),
        is_active: true,
      },
    }),
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinscare002amq9ph-os' },
      create: {
        id: 'cmnhseedinscare002amq9ph-os',
        org_id: org.id,
        patient_id: patients[1].id,
        insurance_type: 'care',
        application_status: 'change_pending',
        insurer_number: '137000',
        number: null,
        previous_care_level: 'care_1',
        provisional_care_level: 'care_2',
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
      },
      update: {
        org_id: org.id,
        patient_id: patients[1].id,
        insurance_type: 'care',
        application_status: 'change_pending',
        insurer_number: '137000',
        number: null,
        previous_care_level: 'care_1',
        provisional_care_level: 'care_2',
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
      },
    }),
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinspub003amq9ph-os' },
      create: {
        id: 'cmnhseedinspub003amq9ph-os',
        org_id: org.id,
        patient_id: patients[2].id,
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '54',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '指定難病公費54の申請中を想定したE2Eデータ',
      },
      update: {
        org_id: org.id,
        patient_id: patients[2].id,
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '54',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '指定難病公費54の申請中を想定したE2Eデータ',
      },
    }),
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinspub004amq9ph-os' },
      create: {
        id: 'cmnhseedinspub004amq9ph-os',
        org_id: org.id,
        patient_id: patients[2].id,
        insurance_type: 'public_subsidy',
        application_status: 'confirmed',
        public_program_code: '21',
        insurer_number: '21130001',
        number: '21000001',
        valid_from: new Date('2026-04-01'),
        is_active: true,
        notes: '自立支援医療公費21の確定済みを想定したE2Eデータ',
      },
      update: {
        org_id: org.id,
        patient_id: patients[2].id,
        insurance_type: 'public_subsidy',
        application_status: 'confirmed',
        public_program_code: '21',
        insurer_number: '21130001',
        number: '21000001',
        valid_from: new Date('2026-04-01'),
        is_active: true,
        notes: '自立支援医療公費21の確定済みを想定したE2Eデータ',
      },
    }),
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinscare005amq9ph-os' },
      create: {
        id: 'cmnhseedinscare005amq9ph-os',
        org_id: org.id,
        patient_id: patients[3].id,
        insurance_type: 'care',
        application_status: 'applying',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '介護保険申請中を想定したE2Eデータ',
      },
      update: {
        org_id: org.id,
        patient_id: patients[3].id,
        insurance_type: 'care',
        application_status: 'applying',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '介護保険申請中を想定したE2Eデータ',
      },
    }),
    prisma.patientInsurance.upsert({
      where: { id: 'cmnhseedinspub006amq9ph-os' },
      create: {
        id: 'cmnhseedinspub006amq9ph-os',
        org_id: org.id,
        patient_id: patients[4].id,
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '21',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '自立支援医療公費21の申請中を想定したE2Eデータ',
      },
      update: {
        org_id: org.id,
        patient_id: patients[4].id,
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '21',
        insurer_number: null,
        number: null,
        application_submitted_at: new Date('2026-06-01'),
        valid_from: new Date('2026-06-01'),
        is_active: true,
        notes: '自立支援医療公費21の申請中を想定したE2Eデータ',
      },
    }),
  ]);

  const institution = await prisma.prescriberInstitution.upsert({
    where: { org_id_name: { org_id: org.id, name: 'サンプル在宅クリニック' } },
    create: {
      id: SEED_IDS.prescriberInstitution,
      org_id: org.id,
      name: 'サンプル在宅クリニック',
      institution_code: '1312345678',
      address: '東京都千代田区丸の内1-2-3',
      phone: '03-1234-0001',
      fax: '03-1234-0002',
      preferred_contact_method: 'fax',
      notes: 'E2E/デモ用処方元医療機関',
    },
    update: {
      institution_code: '1312345678',
      address: '東京都千代田区丸の内1-2-3',
      phone: '03-1234-0001',
      fax: '03-1234-0002',
      preferred_contact_method: 'fax',
      notes: 'E2E/デモ用処方元医療機関',
    },
  });

  await Promise.all([
    prisma.drugMaster.upsert({
      where: { yj_code: '7999401A1010' },
      create: {
        id: SEED_IDS.injectionEligibleDrug,
        yj_code: '7999401A1010',
        receipt_code: '799940101',
        hot_code: '1999401010101',
        drug_name: 'E2E自己注射対象確認済み注射液',
        drug_name_kana: 'E2Eジコチュウシャタイショウカクニンズミチュウシャエキ',
        generic_name: 'E2E自己注射対象確認済み',
        unit: 'キット',
        dosage_form: '注射液',
        therapeutic_category: '7999',
        manufacturer: 'PH-OS Demo',
        outpatient_injection_eligible: true,
        outpatient_injection_note: 'E2E用。外来/在宅自己注射対象として薬剤マスターで手動確認済み。',
      },
      update: {
        receipt_code: '799940101',
        hot_code: '1999401010101',
        drug_name: 'E2E自己注射対象確認済み注射液',
        drug_name_kana: 'E2Eジコチュウシャタイショウカクニンズミチュウシャエキ',
        generic_name: 'E2E自己注射対象確認済み',
        unit: 'キット',
        dosage_form: '注射液',
        therapeutic_category: '7999',
        manufacturer: 'PH-OS Demo',
        outpatient_injection_eligible: true,
        outpatient_injection_note: 'E2E用。外来/在宅自己注射対象として薬剤マスターで手動確認済み。',
      },
    }),
    prisma.drugMaster.upsert({
      where: { yj_code: '7999402A1015' },
      create: {
        id: SEED_IDS.injectionBlockedDrug,
        yj_code: '7999402A1015',
        receipt_code: '799940202',
        hot_code: '1999402020202',
        drug_name: 'E2E院外不可確認用注射液',
        drug_name_kana: 'E2Eインガイフカカクニンヨウチュウシャエキ',
        generic_name: 'E2E院外不可確認用',
        unit: '瓶',
        dosage_form: '注射液',
        therapeutic_category: '7999',
        manufacturer: 'PH-OS Demo',
        outpatient_injection_eligible: false,
        outpatient_injection_note: 'E2E用。薬局での院外処方可否未確認としてブロックする。',
      },
      update: {
        receipt_code: '799940202',
        hot_code: '1999402020202',
        drug_name: 'E2E院外不可確認用注射液',
        drug_name_kana: 'E2Eインガイフカカクニンヨウチュウシャエキ',
        generic_name: 'E2E院外不可確認用',
        unit: '瓶',
        dosage_form: '注射液',
        therapeutic_category: '7999',
        manufacturer: 'PH-OS Demo',
        outpatient_injection_eligible: false,
        outpatient_injection_note: 'E2E用。薬局での院外処方可否未確認としてブロックする。',
      },
    }),
  ]);

  const [availablePump, rentedPump] = await Promise.all([
    prisma.pcaPump.upsert({
      where: { org_id_asset_code: { org_id: org.id, asset_code: 'PCA-SEED-001' } },
      create: {
        id: SEED_IDS.pcaPumpAvailable,
        org_id: org.id,
        asset_code: 'PCA-SEED-001',
        serial_number: 'PCASEED001',
        model_name: 'E2E PCAポンプ',
        manufacturer: 'PH-OS Demo',
        status: 'available',
        maintenance_due_at: new Date('2026-12-31'),
        notes: 'E2E/デモ用の貸出可能PCAポンプ',
      },
      update: {
        serial_number: 'PCASEED001',
        model_name: 'E2E PCAポンプ',
        manufacturer: 'PH-OS Demo',
        status: 'available',
        maintenance_due_at: new Date('2026-12-31'),
        notes: 'E2E/デモ用の貸出可能PCAポンプ',
      },
    }),
    prisma.pcaPump.upsert({
      where: { org_id_asset_code: { org_id: org.id, asset_code: 'PCA-SEED-002' } },
      create: {
        id: SEED_IDS.pcaPumpRented,
        org_id: org.id,
        asset_code: 'PCA-SEED-002',
        serial_number: 'PCASEED002',
        model_name: 'E2E PCAポンプ',
        manufacturer: 'PH-OS Demo',
        status: 'rented',
        maintenance_due_at: new Date('2026-12-31'),
        notes: 'E2E/デモ用の貸出中PCAポンプ',
      },
      update: {
        serial_number: 'PCASEED002',
        model_name: 'E2E PCAポンプ',
        manufacturer: 'PH-OS Demo',
        status: 'rented',
        maintenance_due_at: new Date('2026-12-31'),
        notes: 'E2E/デモ用の貸出中PCAポンプ',
      },
    }),
  ]);

  await prisma.pcaPumpRental.upsert({
    where: { id: SEED_IDS.pcaRentalActive },
    create: {
      id: SEED_IDS.pcaRentalActive,
      org_id: org.id,
      pump_id: rentedPump.id,
      institution_id: institution.id,
      status: 'active',
      rented_at: new Date('2026-06-01'),
      due_at: new Date('2026-06-30'),
      contact_name: '訪問看護師',
      contact_phone: '03-1234-0003',
      rental_fee_yen: 12000,
      notes: 'E2E/デモ用の貸出中レコード',
    },
    update: {
      org_id: org.id,
      pump_id: rentedPump.id,
      institution_id: institution.id,
      status: 'active',
      rented_at: new Date('2026-06-01'),
      due_at: new Date('2026-06-30'),
      returned_at: null,
      contact_name: '訪問看護師',
      contact_phone: '03-1234-0003',
      rental_fee_yen: 12000,
      notes: 'E2E/デモ用の貸出中レコード',
    },
  });

  console.log('Seed data created:', {
    org: org.id,
    site: site.id,
    user: user.id,
    patients: patients.length,
    careCases: careCases.length,
    prescriberInstitution: institution.id,
    vehicleResource: vehicleResource.id,
    pcaPumps: [availablePump.id, rentedPump.id],
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
