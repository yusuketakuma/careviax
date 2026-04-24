'use client';

import { MainWorkflowRoute } from '@/components/features/workflow/main-workflow-route';

export function WorkflowNavigation() {
  return (
    <div data-testid="dashboard-phase-rail">
      <MainWorkflowRoute dataTestId="dashboard-main-workflow-route" />
    </div>
  );
}
