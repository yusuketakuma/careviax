import { describe, expect, it } from 'vitest';
import {
  MOBILE_BOTTOM_NAV_ITEMS,
  SIDEBAR_ADMIN_NAV_GROUPS,
  SIDEBAR_MAIN_NAV_GROUPS,
} from './navigation-config';

const allMainItems = SIDEBAR_MAIN_NAV_GROUPS.flatMap((group) => group.items);

describe('layout navigation config', () => {
  it('keeps the design/images/new sidebar as grouped navigation (今日/患者/工程/連携/管理)', () => {
    expect(SIDEBAR_MAIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      '今日',
      '患者',
      '工程',
      '連携',
      '管理',
    ]);

    expect(
      SIDEBAR_MAIN_NAV_GROUPS.map((group) => group.items.map((item) => item.label)),
    ).toEqual([
      ['ダッシュボード', 'スケジュール', '訪問'],
      ['患者一覧'],
      ['処方取込', 'カード', '調剤', '監査', 'セット', '報告・共有', '算定チェック'],
      ['ハンドオフ'],
      ['マスター', '設定'],
    ]);

    expect(allMainItems.map((item) => item.href)).toEqual([
      '/dashboard',
      '/schedules',
      '/visits',
      '/patients',
      '/prescriptions/intake',
      '/prescriptions',
      '/dispensing',
      '/auditing',
      '/medication-sets',
      '/reports',
      '/billing',
      '/handoff',
      '/admin',
      '/settings',
    ]);
  });

  it('keeps pages without their own sidebar item reachable via active prefixes', () => {
    const dashboard = allMainItems.find((item) => item.label === 'ダッシュボード');
    const handoff = allMainItems.find((item) => item.label === 'ハンドオフ');
    const intake = allMainItems.find((item) => item.label === '処方取込');

    expect(dashboard?.activePrefixes).toEqual(
      expect.arrayContaining(['/workflow', '/tasks', '/today', '/notifications']),
    );
    expect(handoff?.activePrefixes).toEqual(
      expect.arrayContaining(['/handoff', '/visits/handoffs', '/communications', '/conferences', '/external']),
    );
    expect(intake?.activePrefixes).toEqual(expect.arrayContaining(['/qr-scan']));
  });

  it('separates the patient list (exact) from the card workspace (/patients/[id])', () => {
    const patientList = allMainItems.find((item) => item.label === '患者一覧');
    const card = allMainItems.find((item) => item.label === 'カード');

    expect(patientList).toEqual(
      expect.objectContaining({
        href: '/patients',
        exact: true,
        activePrefixes: ['/patients', '/patients/new'],
      }),
    );
    expect(card).toEqual(
      expect.objectContaining({
        href: '/prescriptions',
        activePrefixes: expect.arrayContaining(['/prescriptions', '/patients']),
        excludePrefixes: ['/prescriptions/new', '/prescriptions/intake'],
        excludeExact: expect.arrayContaining(['/patients', '/patients/new']),
      }),
    );
  });

  it('marks dynamic badge tones for auditing (critical) and handoff (caution)', () => {
    const auditing = allMainItems.find((item) => item.label === '監査');
    const handoff = allMainItems.find((item) => item.label === 'ハンドオフ');

    expect(auditing?.badgeTone).toBe('critical');
    expect(handoff?.badgeTone).toBe('caution');
  });

  it('drops the standalone report item and folds analytics back into マスター', () => {
    expect(allMainItems.find((item) => item.label === 'レポート')).toBeUndefined();

    const master = allMainItems.find((item) => item.label === 'マスター');
    expect(master?.activePrefixes).toEqual(['/admin']);
    expect(master?.excludePrefixes).toBeUndefined();
  });

  it('keeps mobile field-work shortcuts focused on schedule and visit execution', () => {
    expect(MOBILE_BOTTOM_NAV_ITEMS.map((item) => item.label)).toEqual([
      'ホーム',
      'スケジュール',
      '訪問',
      '患者',
    ]);
    expect(MOBILE_BOTTOM_NAV_ITEMS.find((item) => item.label === '訪問')).toEqual(
      expect.objectContaining({
        activePrefixes: ['/visits', '/my-day'],
        excludePrefixes: ['/visits/handoffs'],
      }),
    );
  });

  it('includes packaging method management in the admin drug master group', () => {
    const drugGroup = SIDEBAR_ADMIN_NAV_GROUPS.find((group) => group.label === '薬剤');

    expect(drugGroup?.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(['採用薬', '配薬方法', 'マスタ', '処方安全アラート']),
    );
  });
});
