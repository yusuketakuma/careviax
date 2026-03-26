import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to run prisma seed');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 組織
  const org = await prisma.organization.create({
    data: {
      name: 'サンプル薬局',
      address: '東京都千代田区丸の内1-1-1',
    },
  });

  // 薬局サイト
  const site = await prisma.pharmacySite.create({
    data: {
      org_id: org.id,
      name: 'サンプル薬局 本店',
      address: '東京都千代田区丸の内1-1-1',
      lat: 35.6812,
      lng: 139.7671,
    },
  });

  // ユーザー（管理者薬剤師）
  const user = await prisma.user.create({
    data: {
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
    prisma.patient.create({
      data: {
        org_id: org.id,
        name: '佐藤 花子',
        name_kana: 'サトウ ハナコ',
        birth_date: new Date('1945-03-15'),
        gender: 'female',
        phone: '090-1234-5678',
      },
    }),
    prisma.patient.create({
      data: {
        org_id: org.id,
        name: '鈴木 一郎',
        name_kana: 'スズキ イチロウ',
        birth_date: new Date('1950-07-22'),
        gender: 'male',
        phone: '090-9876-5432',
      },
    }),
    prisma.patient.create({
      data: {
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
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
