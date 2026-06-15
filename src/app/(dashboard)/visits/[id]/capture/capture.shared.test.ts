import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CATEGORIES,
  projectEvidenceCategory,
} from '../../evidence/evidence-gallery.shared';
import {
  CAPTURE_CATEGORY_OPTIONS,
  DEFAULT_CAPTURE_CATEGORY,
  buildCaptureStatusSummary,
  buildEvidenceDraftFileName,
  findCaptureCategoryOption,
  mimeTypeToExtension,
  resolveCapturePatientContext,
} from './capture.shared';

/** ローカルタイムで固定の撮影時刻を作る(タイムゾーン非依存のテストにする) */
const CAPTURED_AT = new Date(2026, 5, 13, 10, 30, 45);

describe('CAPTURE_CATEGORY_OPTIONS', () => {
  it('target の 3 チップ(残薬写真=紫 / セット設置=緑 / 説明資料=紫)を表示順で持つ', () => {
    expect(
      CAPTURE_CATEGORY_OPTIONS.map((option) => ({ label: option.label, tone: option.tone })),
    ).toEqual([
      { label: '残薬写真', tone: 'violet' },
      { label: 'セット設置', tone: 'emerald' },
      { label: '説明資料', tone: 'violet' },
    ]);
  });

  it('p0_33 の証跡 6 区分のサブセットに対応づく', () => {
    const categoryIds = new Set<string>(EVIDENCE_CATEGORIES.map((category) => category.id));
    for (const option of CAPTURE_CATEGORY_OPTIONS) {
      expect(categoryIds.has(option.id)).toBe(true);
    }
    expect(DEFAULT_CAPTURE_CATEGORY).toBe('residual_photo');
  });
});

describe('buildEvidenceDraftFileName', () => {
  it('「チップ名_yyyyMMdd-HHmmss.拡張子」を生成する', () => {
    expect(buildEvidenceDraftFileName('residual_photo', CAPTURED_AT)).toBe(
      '残薬写真_20260613-103045.jpg',
    );
    expect(buildEvidenceDraftFileName('set_photo', CAPTURED_AT, 'image/png')).toBe(
      'セット設置_20260613-103045.png',
    );
    expect(buildEvidenceDraftFileName('document_delivery', CAPTURED_AT, 'image/webp')).toBe(
      '説明資料_20260613-103045.webp',
    );
  });

  it('生成名は同期後の p0_33 ファイル名射影でも同じ区分へ戻る(往復一致)', () => {
    for (const option of CAPTURE_CATEGORY_OPTIONS) {
      const fileName = buildEvidenceDraftFileName(option.id, CAPTURED_AT);
      expect(projectEvidenceCategory({ purpose: 'visit-photo', kind: 'photo', fileName })).toBe(
        option.id,
      );
    }
  });

  it('未知の区分 ID は既定チップ(残薬写真)へ寄せる', () => {
    expect(buildEvidenceDraftFileName('report_copy', CAPTURED_AT)).toBe(
      '残薬写真_20260613-103045.jpg',
    );
  });
});

describe('findCaptureCategoryOption', () => {
  it('選択区分のチップ定義を返し、対象外なら既定チップに寄せる', () => {
    expect(findCaptureCategoryOption('set_photo').label).toBe('セット設置');
    expect(findCaptureCategoryOption('report_copy').label).toBe('残薬写真');
  });
});

describe('buildCaptureStatusSummary', () => {
  it('撮影前の患者・区分・保存先説明を組み立てる', () => {
    expect(
      buildCaptureStatusSummary({
        categoryId: 'document_delivery',
        patientName: '田中 一郎',
        savedCount: 0,
      }),
    ).toEqual({
      categoryLabel: '説明資料',
      patientLabel: '田中 一郎 様',
      savedDraftLabel: '撮影前',
      description: '説明資料として端末に保存し、画像・証跡では未同期として確認できます。',
    });
  });

  it('保存済み枚数と患者未確定を表示できる', () => {
    expect(
      buildCaptureStatusSummary({
        categoryId: 'residual_photo',
        patientName: null,
        savedCount: 2,
      }),
    ).toMatchObject({
      patientLabel: '患者未確定',
      savedDraftLabel: 'この訪問で端末保存 2枚',
    });
  });
});

describe('mimeTypeToExtension', () => {
  it('jpeg/png/webp を対応する拡張子へ、未知は jpg へ変換する', () => {
    expect(mimeTypeToExtension('image/jpeg')).toBe('jpg');
    expect(mimeTypeToExtension('image/png')).toBe('png');
    expect(mimeTypeToExtension('image/webp')).toBe('webp');
    expect(mimeTypeToExtension('application/octet-stream')).toBe('jpg');
  });
});

describe('resolveCapturePatientContext', () => {
  it('訪問予定詳細から患者名・患者 ID・訪問記録 ID を取り出す', () => {
    expect(
      resolveCapturePatientContext({
        patient_id: 'patient-1',
        case_: { patient: { name: '田中 一郎' } },
        visit_record: { id: 'record-1' },
      }),
    ).toEqual({
      patientId: 'patient-1',
      patientName: '田中 一郎',
      visitRecordId: 'record-1',
    });
  });

  it('記録未作成・患者名なしは null として扱う', () => {
    expect(
      resolveCapturePatientContext({ patient_id: 'patient-1', case_: null, visit_record: null }),
    ).toEqual({ patientId: 'patient-1', patientName: null, visitRecordId: null });
  });

  it('オブジェクト以外や空文字は安全に null へ落とす', () => {
    expect(resolveCapturePatientContext(null)).toEqual({
      patientId: null,
      patientName: null,
      visitRecordId: null,
    });
    expect(
      resolveCapturePatientContext({
        patient_id: '',
        case_: { patient: { name: '   ' } },
        visit_record: { id: 42 },
      }),
    ).toEqual({ patientId: null, patientName: null, visitRecordId: null });
  });
});
