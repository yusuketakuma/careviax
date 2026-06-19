import { describe, expect, it } from 'vitest';
import { labelForPath, labelForSegment } from './route-labels';

describe('route labels', () => {
  it('labels admin sub-pages explicitly for recent-history navigation', () => {
    expect(labelForPath('/admin/pharmacy-sites')).toBe('薬局情報');
    expect(labelForPath('/admin/service-areas')).toBe('訪問エリア');
    expect(labelForPath('/admin/jobs')).toBe('ジョブ監視');
    expect(labelForPath('/admin/document-templates')).toBe('文書テンプレート');
    expect(labelForPath('/admin/professionals')).toBe('他職種');
    expect(labelForPath('/admin/settings')).toBe('管理設定');
    expect(labelForPath('/admin/performance')).toBe('パフォーマンス');
    expect(labelForPath('/admin/realtime')).toBe('リアルタイム監視');
    expect(labelForPath('/admin/pharmacy-cooperation')).toBe('薬局間協力設定');
    expect(labelForPath('/patients/p1/edit')).toBe('患者情報編集');
    expect(labelForPath('/patients/p1/mcs')).toBe('MCS連携');
    expect(labelForPath('/billing/partner-cooperation')).toBe('薬局間協力');
    expect(labelForPath('/workflow/pharmacy-cooperation')).toBe('薬局間協力');
  });

  it('labels utility segments used by breadcrumb navigation', () => {
    expect(labelForSegment('prescriptions')).toBe('処方受付');
    expect(labelForSegment('prescriptions', 'patients')).toBe('処方履歴');
    expect(labelForSegment('print', 'reports')).toBe('印刷');
    expect(labelForSegment('full', 'set')).toBe('一覧');
    expect(labelForSegment('record', 'visits')).toBe('記録入力');
    expect(labelForSegment('settings', 'admin')).toBe('管理設定');
    expect(labelForSegment('mcs', 'patients')).toBe('MCS連携');
    expect(labelForSegment('collaboration')).toBe('今だれが見ているか');
    expect(labelForSegment('partner-cooperation', 'billing')).toBe('薬局間協力');
    expect(labelForSegment('pharmacy-cooperation', 'workflow')).toBe('薬局間協力');
    expect(labelForSegment('pharmacy-cooperation', 'admin')).toBe('薬局間協力設定');
  });

  it('labels the renamed dispensing workbench segments (audit/set/set-audit)', () => {
    // breadcrumb セグメント単体
    expect(labelForSegment('audit')).toBe('監査');
    expect(labelForSegment('set')).toBe('セット');
    expect(labelForSegment('set-audit')).toBe('セット監査');

    // パス全体ラベル(/set-audit を /set より先に評価し誤包含を防ぐ)
    expect(labelForPath('/audit')).toBe('調剤鑑査');
    expect(labelForPath('/set')).toBe('セット');
    expect(labelForPath('/set-audit')).toBe('セット監査');
  });
});
