// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const tasksContentMock = vi.hoisted(() => vi.fn());
const tasksContentMockState = vi.hoisted(() => ({
  suspend: false,
  promise: new Promise(() => undefined),
}));

vi.mock('./tasks-content', () => ({
  TasksContent: (props: {
    initialAssigned?: string;
    initialStatus?: string;
    initialTaskType?: string;
    initialPriority?: string;
    initialContext?: string;
    initialWorkRequestType?: string;
    initialWorkRequestTitle?: string;
    initialWorkRequestDescription?: string;
    initialRelatedEntityType?: string;
    initialRelatedEntityId?: string;
  }) => {
    tasksContentMock(props);
    if (tasksContentMockState.suspend) {
      throw tasksContentMockState.promise;
    }
    return <section data-testid="tasks-content" />;
  },
}));

import TasksPage from './page';

setupDomTestEnv();

describe('TasksPage', () => {
  beforeEach(() => {
    tasksContentMock.mockClear();
    tasksContentMockState.suspend = false;
  });

  async function renderPage() {
    const page = await TasksPage({
      searchParams: Promise.resolve({
        assigned: 'me',
        status: 'pending',
        task_type: 'visit',
        priority: 'high',
        context: 'dashboard_home',
        work_request_type: 'staff_work_request_visit',
        work_request_title: '確認依頼',
        work_request_description: '対応内容',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    });
    return render(page);
  }

  it('renders the tasks shell with search params', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: 'タスク' })).toBeTruthy();
    expect(screen.getByTestId('tasks-content')).toBeTruthy();
    expect(tasksContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialAssigned: 'me',
        initialStatus: 'pending',
        initialTaskType: 'visit',
        initialPriority: 'high',
        initialContext: 'dashboard_home',
        initialWorkRequestType: 'staff_work_request_visit',
        initialWorkRequestTitle: '確認依頼',
        initialWorkRequestDescription: '対応内容',
        initialRelatedEntityType: 'patient',
        initialRelatedEntityId: 'patient_1',
      }),
    );
  });

  it('uses a screen-specific loading status for the route shell fallback', async () => {
    tasksContentMockState.suspend = true;

    await renderPage();

    expect(screen.getByRole('heading', { name: 'タスク' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'タスクを読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByTestId('tasks-content')).toBeNull();
  });
});
