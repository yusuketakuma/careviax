import Link from 'next/link';
import {
  Building2,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Stethoscope,
  UserPlus,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';

type StepDefinition = {
  key: string;
  label: string;
  description: string;
  href: string;
  completed: boolean;
  countLabel: string;
  icon: typeof Building2;
};

export async function OnboardingChecklist() {
  const session = await auth();
  const localUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });

  if (!localUser?.org_id) {
    return null;
  }

  const [siteCount, pharmacistCount, patientCount, scheduledVisitCount] =
    await Promise.all([
      prisma.pharmacySite.count({
        where: { org_id: localUser.org_id },
      }),
      prisma.membership.count({
        where: {
          org_id: localUser.org_id,
          is_active: true,
          role: {
            in: ['pharmacist', 'pharmacist_trainee'],
          },
        },
      }),
      prisma.patient.count({
        where: { org_id: localUser.org_id },
      }),
      prisma.visitSchedule.count({
        where: { org_id: localUser.org_id },
      }),
    ]);

  const steps: StepDefinition[] = [
    {
      key: 'organization',
      label: '組織設定',
      description: '拠点情報と運用の基本設定を登録します。',
      href: '/admin/settings',
      completed: siteCount > 0,
      countLabel: `${siteCount}拠点`,
      icon: Building2,
    },
    {
      key: 'pharmacists',
      label: '薬剤師登録',
      description: '担当薬剤師とシフト運用を設定します。',
      href: '/admin/shifts',
      completed: pharmacistCount > 0,
      countLabel: `${pharmacistCount}名`,
      icon: Stethoscope,
    },
    {
      key: 'patients',
      label: '患者登録',
      description: '訪問対象患者を登録してケースを開始します。',
      href: '/patients/new',
      completed: patientCount > 0,
      countLabel: `${patientCount}名`,
      icon: UserPlus,
    },
    {
      key: 'first-visit',
      label: '初回訪問',
      description: '最初の訪問予定を作成して準備フローを開始します。',
      href: '/schedules',
      completed: scheduledVisitCount > 0,
      countLabel: `${scheduledVisitCount}件`,
      icon: CalendarPlus,
    },
  ];

  const completedCount = steps.filter((step) => step.completed).length;
  if (completedCount === steps.length) {
    return null;
  }

  const nextStep = steps.find((step) => !step.completed) ?? steps[0];

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader>
        <CardTitle>初期導入オンボーディング</CardTitle>
        <CardDescription>
          開始状況 {completedCount}/4。運用開始までの残りステップを確認してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <Link
                key={step.key}
                href={step.href}
                className="rounded-xl border border-blue-100 bg-white/80 p-4 transition-colors hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{step.label}</p>
                        <span className="text-xs text-slate-500">{step.countLabel}</span>
                      </div>
                      <p className="text-sm text-slate-600">{step.description}</p>
                    </div>
                  </div>
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white/80 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">
              次に進める作業: {nextStep.label}
            </p>
            <p className="text-xs text-slate-600">{nextStep.description}</p>
          </div>
          <Link
            href={nextStep.href}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline-offset-4 hover:underline"
          >
            開く
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
