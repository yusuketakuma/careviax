import type { PermissionKey } from '@/lib/auth/permissions';

export type RouteCatalogEntry = {
  path: string;
  methods: string[];
  permission: PermissionKey | 'authenticated' | 'purpose-based' | 'canAdmin|apiKey' | 'public';
  description: string;
  area:
    | 'patients'
    | 'cases'
    | 'schedules'
    | 'visits'
    | 'prescriptions'
    | 'dispensing'
    | 'reports'
    | 'shifts'
    | 'dashboard'
    | 'billing'
    | 'auditing'
    | 'masters'
    | 'files'
    | 'system';
};
