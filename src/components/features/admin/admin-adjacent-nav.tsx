import type { PageShortcutLink } from '@/components/features/workflow/page-shortcut-links';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';

type AdminAdjacentNavProps = {
  shortcuts: readonly PageShortcutLink[];
};

export function AdminAdjacentNav({ shortcuts }: AdminAdjacentNavProps) {
  return (
    <div className="space-y-3">
      <WorkflowBackLink href="/admin" label="マスターへ戻る" />
      <PageShortcutLinks links={shortcuts} />
    </div>
  );
}
