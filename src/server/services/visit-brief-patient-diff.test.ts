import { describe, expect, it } from 'vitest';
import { careLevelLabels } from '@/lib/patient/home-visit-intake';
import { diffPatientStateSnapshots } from './visit-brief-patient-diff';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    captured_at: '2026-06-16T00:00:00.000Z',
    source: 'visit_record',
    case_id: 'case_1',
    patient: { name: '山田 太郎', phone: '090-0000-0000' },
    primary_residence: { address: '東京都千代田区1-2-3', facility_id: null, unit_name: null },
    scheduling_preference: {
      care_level: '要介護2',
      adl_level: null,
      dementia_level: null,
      swallowing_route: null,
      infection_isolation: false,
    },
    conditions: [{ name: '膵癌', is_primary: true }],
    contacts: [{ name: '山田 花子', relation: 'child', phone: '090-1111-2222' }],
    care_team_links: [{ role: 'physician', name: '佐藤医師', organization_name: 'さくら病院' }],
    home_visit_intake: {
      special_medical_procedures: [],
      narcotics_base: false,
      narcotics_rescue: false,
    },
    insurances: [{ insurance_type: 'medical', application_status: 'confirmed', copay_ratio: 30 }],
    ...overrides,
  };
}

describe('diffPatientStateSnapshots', () => {
  it('前回snapshotが null なら空配列(初回訪問/旧記録のグレースフル)', () => {
    expect(diffPatientStateSnapshots(null, snapshot())).toEqual([]);
    expect(diffPatientStateSnapshots(snapshot(), null)).toEqual([]);
    expect(diffPatientStateSnapshots('not-json', snapshot())).toEqual([]);
  });

  it('無変更なら空配列', () => {
    expect(diffPatientStateSnapshots(snapshot(), snapshot())).toEqual([]);
  });

  it('主病名の変更を検出する', () => {
    const prev = snapshot({ conditions: [{ name: '膵癌', is_primary: true }] });
    const cur = snapshot({ conditions: [{ name: '心不全', is_primary: true }] });
    const changes = diffPatientStateSnapshots(prev, cur);
    const condition = changes.find((c) => c.category === 'primary_condition');
    expect(condition).toMatchObject({
      field_label: '主病名',
      previous: '膵癌',
      current: '心不全',
      change_type: 'changed',
    });
  });

  it('介護度の変更を検出する', () => {
    const prev = snapshot({ scheduling_preference: { care_level: '要介護2', infection_isolation: false } });
    const cur = snapshot({ scheduling_preference: { care_level: '要介護4', infection_isolation: false } });
    const changes = diffPatientStateSnapshots(prev, cur);
    expect(changes.find((c) => c.category === 'care_level' && c.field_label === '介護度')).toMatchObject({
      previous: '要介護2',
      current: '要介護4',
      change_type: 'changed',
    });
  });

  it('麻薬の開始(false→true)を added として検出する', () => {
    const prev = snapshot();
    const cur = snapshot({
      home_visit_intake: { special_medical_procedures: [], narcotics_base: true, narcotics_rescue: false },
    });
    const changes = diffPatientStateSnapshots(prev, cur);
    expect(changes.find((c) => c.category === 'narcotic' && c.field_label === '麻薬(ベース)')).toMatchObject({
      change_type: 'added',
    });
  });

  it('医療処置の追加/削除を集合差分で検出する', () => {
    const prev = snapshot({
      home_visit_intake: { special_medical_procedures: ['tube_feeding'], narcotics_base: false, narcotics_rescue: false },
    });
    const cur = snapshot({
      home_visit_intake: { special_medical_procedures: ['tpn'], narcotics_base: false, narcotics_rescue: false },
    });
    const changes = diffPatientStateSnapshots(prev, cur);
    const procedures = changes.filter((c) => c.category === 'medical_procedure');
    expect(procedures.some((c) => c.change_type === 'added')).toBe(true);
    expect(procedures.some((c) => c.change_type === 'removed')).toBe(true);
  });

  it('多職種(主治医)の交代を検出する', () => {
    const prev = snapshot();
    const cur = snapshot({
      care_team_links: [{ role: 'physician', name: '田中医師', organization_name: 'さくら病院' }],
    });
    const changes = diffPatientStateSnapshots(prev, cur);
    const careTeam = changes.filter((c) => c.category === 'care_team');
    expect(careTeam.some((c) => c.change_type === 'added' && c.current === '田中医師')).toBe(true);
    expect(careTeam.some((c) => c.change_type === 'removed' && c.previous === '佐藤医師')).toBe(true);
  });

  it('集合の順序のみ変更では偽差分を出さない(連絡先)', () => {
    const prev = snapshot({
      contacts: [
        { name: 'A', relation: 'child', phone: '1' },
        { name: 'B', relation: 'spouse', phone: '2' },
      ],
    });
    const cur = snapshot({
      contacts: [
        { name: 'B', relation: 'spouse', phone: '2' },
        { name: 'A', relation: 'child', phone: '1' },
      ],
    });
    expect(diffPatientStateSnapshots(prev, cur).some((c) => c.category === 'contact')).toBe(false);
  });

  it('case_id が食い違う場合は case 依存カテゴリ(麻薬/医療処置/多職種)を比較しない', () => {
    const prev = snapshot({
      case_id: 'case_1',
      care_team_links: [{ role: 'physician', name: '佐藤医師', organization_name: 'さくら病院' }],
      home_visit_intake: { special_medical_procedures: ['tpn'], narcotics_base: true, narcotics_rescue: false },
    });
    const cur = snapshot({
      case_id: 'case_2',
      care_team_links: [{ role: 'physician', name: '田中医師', organization_name: '別病院' }],
      home_visit_intake: { special_medical_procedures: [], narcotics_base: false, narcotics_rescue: false },
    });
    const changes = diffPatientStateSnapshots(prev, cur);
    expect(changes.some((c) => ['care_team', 'medical_procedure', 'narcotic'].includes(c.category))).toBe(
      false,
    );
  });

  it('機微情報(電話番号)は生値を previous/current に露出しない', () => {
    const prev = snapshot({ patient: { name: '山田 太郎', phone: '090-0000-0000' } });
    const cur = snapshot({ patient: { name: '山田 太郎', phone: '080-9999-8888' } });
    const phoneChange = diffPatientStateSnapshots(prev, cur).find(
      (c) => c.category === 'contact' && c.field_label === '連絡先(電話)',
    );
    expect(phoneChange).toBeDefined();
    expect(phoneChange?.previous).toBeNull();
    expect(phoneChange?.current).toBeNull();
    expect(phoneChange?.change_type).toBe('changed');
  });

  it('care_level はコード値を labelMap で日本語ラベルに変換する', () => {
    const prev = snapshot({ scheduling_preference: { care_level: 'care_2', infection_isolation: false } });
    const cur = snapshot({ scheduling_preference: { care_level: 'care_4', infection_isolation: false } });
    const change = diffPatientStateSnapshots(prev, cur).find((c) => c.field_label === '介護度');
    expect(change?.previous).toBe(careLevelLabels['care_2']);
    expect(change?.current).toBe(careLevelLabels['care_4']);
  });

  it('連絡先の 0件→1件 は集合 change_type が added になる', () => {
    const prev = snapshot({ contacts: [] });
    const cur = snapshot({ contacts: [{ name: 'A', relation: 'child', phone: '1' }] });
    const change = diffPatientStateSnapshots(prev, cur).find(
      (c) => c.category === 'contact' && c.field_label === '連絡先一覧',
    );
    expect(change?.change_type).toBe('added');
  });
});
