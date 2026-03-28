export const queryKeys = {
  patients: {
    all: ['patients'] as const,
    lists: () => [...queryKeys.patients.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.patients.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.patients.all, 'detail', id] as const,
  },
  visits: {
    all: ['visits'] as const,
    lists: () => [...queryKeys.visits.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.visits.lists(), filters] as const,
    detail: (scheduleId: string) => [...queryKeys.visits.all, 'detail', scheduleId] as const,
  },
  prescriptions: {
    all: ['prescriptions'] as const,
    lists: () => [...queryKeys.prescriptions.all, 'list'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.prescriptions.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.prescriptions.all, 'detail', id] as const,
  },
  schedules: {
    all: ['schedules'] as const,
    lists: () => [...queryKeys.schedules.all, 'list'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.schedules.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.schedules.all, 'detail', id] as const,
  },
  workflows: {
    all: ['workflows'] as const,
    dashboard: () => [...queryKeys.workflows.all, 'dashboard'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    unread: () => [...queryKeys.notifications.all, 'unread'] as const,
  },
  auditLogs: {
    all: ['audit-logs'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.auditLogs.all, 'list', filters] as const,
  },
} as const;
