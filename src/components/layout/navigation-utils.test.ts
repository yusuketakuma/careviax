import { describe, expect, it } from 'vitest';
import { isLayoutNavItemActive } from './navigation-utils';
import { SIDEBAR_MAIN_NAV_GROUPS } from './navigation-config';
import { Home } from 'lucide-react';

const allMainItems = SIDEBAR_MAIN_NAV_GROUPS.flatMap((group) => group.items);

describe('layout navigation active matching', () => {
  it('highlights the dashboard item for workflow/tasks/notifications sub pages', () => {
    const dashboard = allMainItems.find((item) => item.label === 'ダッシュボード');
    if (!dashboard) throw new Error('dashboard item is required');

    expect(isLayoutNavItemActive('/dashboard', dashboard)).toBe(true);
    expect(isLayoutNavItemActive('/workflow', dashboard)).toBe(true);
    expect(isLayoutNavItemActive('/notifications', dashboard)).toBe(true);
    expect(isLayoutNavItemActive('/patients/patient_1', dashboard)).toBe(false);
    expect(isLayoutNavItemActive('/schedules', dashboard)).toBe(false);
  });

  it('separates prescription intake from the card item', () => {
    const intake = allMainItems.find((item) => item.label === '処方取込');
    const card = allMainItems.find((item) => item.label === 'カード');
    if (!intake || !card) throw new Error('prescription items are required');

    expect(isLayoutNavItemActive('/prescriptions/new', intake)).toBe(true);
    expect(isLayoutNavItemActive('/qr-scan', intake)).toBe(true);
    expect(isLayoutNavItemActive('/prescriptions/new', card)).toBe(false);
    expect(isLayoutNavItemActive('/prescriptions', card)).toBe(true);
  });

  it('activates 患者一覧 on the list page and カード on patient detail pages', () => {
    const patientList = allMainItems.find((item) => item.label === '患者一覧');
    const card = allMainItems.find((item) => item.label === 'カード');
    if (!patientList || !card) throw new Error('patient/card items are required');

    // 一覧(完全一致系) → 患者一覧のみアクティブ
    expect(isLayoutNavItemActive('/patients', patientList)).toBe(true);
    expect(isLayoutNavItemActive('/patients', card)).toBe(false);
    expect(isLayoutNavItemActive('/patients/new', patientList)).toBe(true);
    expect(isLayoutNavItemActive('/patients/new', card)).toBe(false);

    // 患者詳細(= カード作業台) → カードのみアクティブ
    expect(isLayoutNavItemActive('/patients/patient_1', patientList)).toBe(false);
    expect(isLayoutNavItemActive('/patients/patient_1', card)).toBe(true);
    expect(isLayoutNavItemActive('/patients/patient_1/edit', patientList)).toBe(false);
    expect(isLayoutNavItemActive('/patients/patient_1/edit', card)).toBe(true);
  });

  it('keeps admin analytics pages inside the master item after the report item removal', () => {
    const master = allMainItems.find((item) => item.label === 'マスター');
    if (!master) throw new Error('master item is required');

    expect(isLayoutNavItemActive('/admin/analytics', master)).toBe(true);
    expect(isLayoutNavItemActive('/admin/metrics', master)).toBe(true);
    expect(isLayoutNavItemActive('/admin/drug-masters', master)).toBe(true);
  });

  it('matches plain items by their href prefix', () => {
    const home = { label: 'ホーム', href: '/dashboard', icon: Home };

    expect(isLayoutNavItemActive('/dashboard', home)).toBe(true);
    expect(isLayoutNavItemActive('/dashboard-preview', home)).toBe(false);
  });

  it('matches exact items only on the exact path', () => {
    const exactItem = {
      label: '患者一覧',
      href: '/patients',
      icon: Home,
      exact: true,
      activePrefixes: ['/patients', '/patients/new'],
    };

    expect(isLayoutNavItemActive('/patients', exactItem)).toBe(true);
    expect(isLayoutNavItemActive('/patients/new', exactItem)).toBe(true);
    expect(isLayoutNavItemActive('/patients/patient_1', exactItem)).toBe(false);
  });

  it('excludes exact paths without dropping deeper sub paths', () => {
    const cardLike = {
      label: 'カード',
      href: '/prescriptions',
      icon: Home,
      activePrefixes: ['/prescriptions', '/patients'],
      excludePrefixes: ['/prescriptions/new'],
      excludeExact: ['/patients', '/patients/new'],
    };

    expect(isLayoutNavItemActive('/patients', cardLike)).toBe(false);
    expect(isLayoutNavItemActive('/patients/new', cardLike)).toBe(false);
    expect(isLayoutNavItemActive('/patients/patient_1', cardLike)).toBe(true);
    expect(isLayoutNavItemActive('/prescriptions/new/scan', cardLike)).toBe(false);
  });
});
