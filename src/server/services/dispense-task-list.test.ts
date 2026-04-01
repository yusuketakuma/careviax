import { describe, expect, it } from 'vitest';
import { annotateDispenseTask, sortDispenseTasks } from './dispense-task-list';

describe('dispense-task-list', () => {
  it('sorts dispense tasks by priority, due date, and tie-breaker timestamp', () => {
    const tasks = [
      {
        id: 'normal',
        priority: 'normal',
        due_date: null,
        created_at: new Date('2026-04-01T11:00:00.000Z'),
        cycle: { case_: { patient: { residences: [] } } },
      },
      {
        id: 'urgent',
        priority: 'urgent',
        due_date: new Date('2026-04-01T09:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        cycle: { case_: { patient: { residences: [] } } },
      },
      {
        id: 'emergency',
        priority: 'emergency',
        due_date: null,
        created_at: new Date('2026-04-01T12:00:00.000Z'),
        cycle: { case_: { patient: { residences: [] } } },
      },
    ];

    expect(sortDispenseTasks(tasks, 'created_at').map((task) => task.id)).toEqual([
      'emergency',
      'urgent',
      'normal',
    ]);
  });

  it('annotates facility label and overdue state', () => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const task = {
      priority: 'urgent',
      due_date: new Date('2026-04-01T09:00:00.000Z'),
      created_at: new Date('2026-04-01T08:00:00.000Z'),
      cycle: {
        case_: {
          patient: {
            residences: [{ building_id: 'facility_1', address: '施設A' }],
          },
        },
      },
    };

    expect(annotateDispenseTask(task, now)).toMatchObject({
      facility_label: 'facility_1',
      is_overdue: true,
    });
  });
});
