'use client';

import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FilePlus,
  FileText,
  Pill,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DASHBOARD_WORKFLOW_LINKS } from '@/lib/dashboard/home-config';

const WORKFLOW_ICONS = {
  prescriptions: FilePlus,
  dispensing: Pill,
  auditing: ShieldCheck,
  schedules: CalendarDays,
  visits: ClipboardCheck,
  reports: FileText,
  conferences: Users,
} as const;

export function WorkflowNavigation() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {DASHBOARD_WORKFLOW_LINKS.map((workflow) => {
        const Icon = WORKFLOW_ICONS[workflow.key];

        return (
          <Link key={workflow.key} href={workflow.href} className="group">
            <Card className="h-full border-border/70 transition-colors group-hover:border-primary/40 group-hover:bg-muted/30">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    {workflow.title}
                  </h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {workflow.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
