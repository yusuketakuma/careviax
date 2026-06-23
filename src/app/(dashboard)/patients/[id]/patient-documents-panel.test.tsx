// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { FirstVisitDocumentsPanel } from './patient-documents-panel';

setupDomTestEnv();

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(buildOrgJsonHeaders).mockClear();
});

describe('FirstVisitDocumentsPanel', () => {
  it('renders first-visit documents with a semantic section heading', () => {
    render(<FirstVisitDocumentsPanel cases={[]} documents={[]} />);

    expect(screen.getByRole('heading', { level: 2, name: '初回訪問文書・交付記録' }).tagName).toBe(
      'H2',
    );
    expect(screen.getByText('初回訪問文書はまだありません')).toBeTruthy();
    expect(
      screen.getByText('初回訪問の完了後に、緊急連絡先と交付記録を含む文書が自動作成されます。'),
    ).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders editable delivery and document URL fields for existing documents', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documentStatuses={[
            {
              document_type: 'contract',
              label: '契約書',
              status: 'image_saved',
              status_label: '画像保存済み',
              template_name: '居宅療養管理指導契約書 2026年版',
              template_version: 'v1.1',
              storage_location: 'store',
              latest_action_at: '2026-06-17T00:00:00.000Z',
              latest_printed_at: '2026-06-16T00:00:00.000Z',
              latest_print_batch_id: 'print_20260616T013000Z_batch1',
              latest_document_id: 'doc_1',
              has_file: true,
              delivered_at: '2026-06-17T00:00:00.000Z',
              alerts: [],
            },
            {
              document_type: 'important_matters',
              label: '重要事項説明書',
              status: 'not_created',
              status_label: '未作成',
              template_name: null,
              template_version: null,
              storage_location: null,
              latest_action_at: null,
              latest_printed_at: null,
              latest_print_batch_id: null,
              latest_document_id: null,
              has_file: false,
              delivered_at: null,
              alerts: ['重要事項説明書が未作成です'],
            },
          ]}
          printReadiness={{
            overall_status: 'blocked',
            missing_required_count: 1,
            warning_count: 1,
            template_versions: [
              {
                document_type: 'contract',
                label: '契約書',
                template_id: 'template_contract',
                template_name: '居宅療養管理指導契約書 2026年版',
                template_version: 'v1.1',
                effective_from: '2026-04-01T00:00:00.000Z',
                effective_to: null,
              },
              {
                document_type: 'important_matters',
                label: '重要事項説明書',
                template_id: null,
                template_name: null,
                template_version: null,
                effective_from: null,
                effective_to: null,
              },
            ],
            checks: [
              {
                key: 'patient_profile',
                label: '患者基本情報',
                completed: true,
                severity: 'required',
                description: '氏名、フリガナ、生年月日を差し込みできます。',
                action_href: '/patients/patient_1/edit',
                action_label: '基本情報を編集',
              },
              {
                key: 'default_templates',
                label: '既定テンプレート',
                completed: false,
                severity: 'required',
                description: '既定テンプレート未設定: 重要事項説明書',
                action_href: '/admin/document-templates',
                action_label: 'テンプレートを確認',
              },
              {
                key: 'explainer',
                label: '説明担当者',
                completed: false,
                severity: 'warning',
                description: '説明担当者の初期値に使う主担当薬剤師を設定してください。',
                action_href: '/patients/patient_1#patient-profile-summary',
                action_label: '担当者を確認',
              },
            ],
          }}
          documents={[
            {
              id: 'doc_1',
              case_id: 'case_1',
              emergency_contacts: [],
              document_url: '/api/visit-records/record_1/pdf',
              delivered_at: null,
              delivered_to: null,
              created_at: '2026-06-16T00:00:00.000Z',
              updated_at: '2026-06-16T00:00:00.000Z',
              history: [
                {
                  id: 'audit_1',
                  action: 'replaced',
                  document_type: 'contract',
                  template_name: '居宅療養管理指導契約書 2026年版',
                  template_version: 'v1.1',
                  storage_location: 'store',
                  contract_date: '2026-06-10',
                  explanation_date: '2026-06-10',
                  explanation_staff_name: '佐藤薬剤師',
                  signer_type: 'family',
                  signer_name: '山田 花子',
                  signer_relationship: '長女',
                  reason: '署名者を長女へ訂正',
                  note: '本人同席',
                  actor_id: 'user_1',
                  created_at: '2026-06-17T00:00:00.000Z',
                },
              ],
            },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('交付先')).toBeTruthy();
    expect(screen.getByTestId('first-visit-print-readiness')).toBeTruthy();
    expect(screen.getByText('印刷前チェック')).toBeTruthy();
    expect(screen.getByText('不足あり / 必須不足 1件')).toBeTruthy();
    expect(screen.getByText('既定テンプレート未設定: 重要事項説明書')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'テンプレートを確認' })).toHaveProperty(
      'href',
      'http://localhost:3000/admin/document-templates',
    );
    expect(screen.getAllByText('居宅療養管理指導契約書 2026年版 v1.1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('既定テンプレート').length).toBeGreaterThan(0);
    expect(screen.getByText('適用 2026/04/01 - 無期限')).toBeTruthy();
    expect(screen.getByText('テンプレート未設定')).toBeTruthy();
    expect(screen.getByText('適用期間未設定')).toBeTruthy();
    expect(screen.getByTestId('first-visit-document-status-summary')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: '契約・同意書類の現在状態' }),
    ).toBeTruthy();
    expect(screen.getByText('画像保存済み')).toBeTruthy();
    expect(screen.getAllByText('最終印刷').length).toBeGreaterThan(0);
    expect(screen.getByText('2026/06/16')).toBeTruthy();
    expect(screen.getByText('print_20260616T013000Z_batch1')).toBeTruthy();
    expect(screen.getByText('重要事項説明書が未作成です')).toBeTruthy();
    expect(screen.getByLabelText('文書URL')).toHaveProperty(
      'value',
      '/api/visit-records/record_1/pdf',
    );
    expect(screen.getByLabelText('履歴操作')).toBeTruthy();
    expect(screen.getByLabelText('書類種別')).toBeTruthy();
    expect(screen.getByLabelText('原本保管場所')).toBeTruthy();
    expect(screen.getByLabelText('契約日')).toBeTruthy();
    expect(screen.getByLabelText('説明日')).toBeTruthy();
    expect(screen.getByLabelText('説明者')).toBeTruthy();
    expect(screen.getByLabelText('同意者')).toBeTruthy();
    expect(screen.getByLabelText('署名者氏名')).toBeTruthy();
    expect(screen.getByLabelText('続柄')).toBeTruthy();
    expect(screen.getByText('保存される履歴')).toBeTruthy();
    expect(screen.getAllByText('画像保存').length).toBeGreaterThan(0);
    expect(screen.getAllByText('控え').length).toBeGreaterThan(0);
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).not.toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('履歴操作'), { target: { value: 'replaced' } });
    expect(
      screen.getByText(
        'この操作は監査履歴に理由が残ります。差替え・無効化の判断理由を入力してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('差替え・無効化では理由を入力してください。')).toBeTruthy();
    expect(saveButton).toHaveProperty('disabled', true);
    const reasonBlocker = screen.getByText('保存するには、理由を入力してください。');
    expect(saveButton.getAttribute('aria-describedby')).toBe(reasonBlocker.id);
    expect(reasonBlocker.textContent).not.toMatch(/山田|花子|長女|署名者|佐藤薬剤師/);
    fireEvent.change(screen.getByLabelText('理由'), {
      target: { value: '署名者を長女へ訂正' },
    });
    expect(saveButton).not.toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByText('文書履歴')).toBeTruthy();
    const printPreviewLink = screen.getByRole('link', { name: '印刷プレビュー' });
    expect(printPreviewLink).toHaveProperty(
      'href',
      'http://localhost:3000/reports/print?type=first_visit_documents&patient_id=patient_1',
    );
    expect(screen.getAllByText('差替え').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/契約書/).length).toBeGreaterThan(0);
    expect(screen.getByText('契約日: 2026-06-10')).toBeTruthy();
    expect(screen.getByText('説明: 2026-06-10 / 佐藤薬剤師')).toBeTruthy();
    expect(screen.getByText('署名者: 山田 花子 / 家族 / 長女')).toBeTruthy();
    expect(screen.getByText('理由: 署名者を長女へ訂正')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('requires signed document URL and delivery target for document history actions', () => {
    const queryClient = new QueryClient();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documentStatuses={[]}
          documents={[
            {
              id: 'doc_1',
              case_id: 'case_1',
              emergency_contacts: [],
              document_url: null,
              delivered_at: null,
              delivered_to: null,
              created_at: '2026-06-16T00:00:00.000Z',
              updated_at: '2026-06-16T00:00:00.000Z',
              history: [],
            },
          ]}
        />
      </QueryClientProvider>,
    );

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(
      screen.getByText('画像保存・差替えでは署名済み書類のURLを入力してください。'),
    ).toBeTruthy();
    const urlBlocker = screen.getByText('保存するには、文書URLを入力してください。');
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(urlBlocker.id);
    expect(urlBlocker.textContent).not.toMatch(/山田|長女|https|doc_1|patient_1/);

    fireEvent.change(screen.getByLabelText('履歴操作'), { target: { value: 'replaced' } });
    const replaceBlocker = screen.getByText('保存するには、文書URL、理由を入力してください。');
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(replaceBlocker.id);
    expect(replaceBlocker.textContent).not.toMatch(/山田|長女|https|doc_1|patient_1/);

    fireEvent.submit(saveButton.closest('form')!);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('文書URL'), {
      target: { value: 'https://files.example.test/signed/doc_1.pdf' },
    });
    const reasonBlocker = screen.getByText('保存するには、理由を入力してください。');
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(reasonBlocker.id);
    expect(reasonBlocker.textContent).not.toMatch(/山田|長女|https|doc_1|patient_1/);

    fireEvent.change(screen.getByLabelText('理由'), {
      target: { value: '署名者を長女へ訂正' },
    });
    expect(saveButton).not.toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();

    fireEvent.change(screen.getByLabelText('履歴操作'), { target: { value: 'recovered' } });
    expect(screen.getByText('回収では同意者・交付先を入力してください。')).toBeTruthy();
    const deliveryBlocker = screen.getByText('保存するには、交付先を入力してください。');
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(deliveryBlocker.id);
    expect(deliveryBlocker.textContent).not.toMatch(/山田|長女|https|doc_1|patient_1/);

    fireEvent.change(screen.getByLabelText('交付先'), { target: { value: '長女 山田' } });
    expect(saveButton).not.toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();

    fireEvent.change(screen.getByLabelText('理由'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('履歴操作'), { target: { value: 'invalidated' } });
    const invalidateBlocker = screen.getByText('保存するには、理由を入力してください。');
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(invalidateBlocker.id);
    expect(invalidateBlocker.textContent).not.toMatch(/山田|長女|https|doc_1|patient_1|署名者/);
  });

  it('creates missing first-visit documents from available default templates', async () => {
    const queryClient = new QueryClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 'doc_new' } }), { status: 200 }),
      );
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValueOnce(sentinelHeaders);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documents={[]}
          documentStatuses={[
            {
              document_type: 'important_matters',
              label: '重要事項説明書',
              status: 'not_created',
              status_label: '未作成',
              template_name: null,
              template_version: null,
              storage_location: null,
              latest_action_at: null,
              latest_printed_at: null,
              latest_print_batch_id: null,
              latest_document_id: null,
              has_file: false,
              delivered_at: null,
              alerts: ['重要事項説明書が未作成です'],
            },
            {
              document_type: 'privacy_consent',
              label: '個人情報同意書',
              status: 'not_created',
              status_label: '未作成',
              template_name: null,
              template_version: null,
              storage_location: null,
              latest_action_at: null,
              latest_printed_at: null,
              latest_print_batch_id: null,
              latest_document_id: null,
              has_file: false,
              delivered_at: null,
              alerts: ['個人情報同意書が未作成です'],
            },
          ]}
          printReadiness={{
            overall_status: 'ready',
            missing_required_count: 0,
            warning_count: 0,
            template_versions: [
              {
                document_type: 'important_matters',
                label: '重要事項説明書',
                template_id: 'template_important',
                template_name: '重要事項説明書 2026年版',
                template_version: 'v2',
                effective_from: '2026-04-01T00:00:00.000Z',
                effective_to: null,
              },
              {
                document_type: 'privacy_consent',
                label: '個人情報同意書',
                template_id: null,
                template_name: null,
                template_version: null,
                effective_from: null,
                effective_to: null,
              },
            ],
            checks: [],
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('未作成書類を起票できます')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '未作成書類を作成' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/first-visit-documents', {
      method: 'POST',
      headers: sentinelHeaders,
      body: JSON.stringify({
        patient_id: 'patient_1',
        case_id: 'case_1',
        template_id: 'template_important',
      }),
    });
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('encodes first-visit document ids and preserves the update body when saving history', async () => {
    const queryClient = new QueryClient();
    const hostileDocumentId = 'doc/1?x=y#z';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: hostileDocumentId } }), { status: 200 }),
      );
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValueOnce(sentinelHeaders);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documentStatuses={[]}
          documents={[
            {
              id: hostileDocumentId,
              case_id: 'case_1',
              emergency_contacts: [],
              document_url: '/api/visit-records/record_1/pdf',
              delivered_at: '2026-06-17T00:00:00.000Z',
              delivered_to: null,
              created_at: '2026-06-16T00:00:00.000Z',
              updated_at: '2026-06-16T00:00:00.000Z',
              history: [],
            },
          ]}
        />
      </QueryClientProvider>,
    );

    fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const expectedBody = {
      delivered_at: '2026-06-17T00:00:00.000Z',
      delivered_to: null,
      document_url: '/api/visit-records/record_1/pdf',
      document_action: {
        action: 'image_saved',
        document_type: 'first_visit_document',
        template_name: null,
        template_version: null,
        storage_location: 'store',
        contract_date: null,
        explanation_date: null,
        explanation_staff_name: null,
        signer_type: 'self',
        signer_name: null,
        signer_relationship: null,
        reason: null,
        note: null,
      },
    };
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/first-visit-documents/${encodeURIComponent(hostileDocumentId)}`,
      {
        method: 'PATCH',
        headers: sentinelHeaders,
        body: JSON.stringify(expectedBody),
      },
    );
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain(hostileDocumentId);
    expect(url).not.toContain('%25');
    expect(init?.body).not.toContain(hostileDocumentId);
  });

  it.each(['.', '..'])(
    'rejects dot first-visit document ids before saving history (%s)',
    async (documentId) => {
      const queryClient = new QueryClient();
      const fetchMock = vi.fn();
      const errorSpy = vi.spyOn(toast, 'error').mockReturnValue('1' as never);
      vi.stubGlobal('fetch', fetchMock);

      render(
        <QueryClientProvider client={queryClient}>
          <FirstVisitDocumentsPanel
            orgId="org_1"
            patientId="patient_1"
            cases={[{ id: 'case_1', status: 'active' } as never]}
            documentStatuses={[]}
            documents={[
              {
                id: documentId,
                case_id: 'case_1',
                emergency_contacts: [],
                document_url: '/api/visit-records/record_1/pdf',
                delivered_at: '2026-06-17T00:00:00.000Z',
                delivered_to: null,
                created_at: '2026-06-16T00:00:00.000Z',
                updated_at: '2026-06-16T00:00:00.000Z',
                history: [],
              },
            ]}
          />
        </QueryClientProvider>,
      );

      fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!);

      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith('Path segment cannot be a dot segment'),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the create mutation returns a malformed 2xx (no success toast, no invalidation)', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const successSpy = vi.spyOn(toast, 'success').mockReturnValue('1' as never);
    const errorSpy = vi.spyOn(toast, 'error').mockReturnValue('1' as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documents={[]}
          documentStatuses={[
            {
              document_type: 'important_matters',
              label: '重要事項説明書',
              status: 'not_created',
              status_label: '未作成',
              template_name: null,
              template_version: null,
              storage_location: null,
              latest_action_at: null,
              latest_printed_at: null,
              latest_print_batch_id: null,
              latest_document_id: null,
              has_file: false,
              delivered_at: null,
              alerts: ['重要事項説明書が未作成です'],
            },
          ]}
          printReadiness={{
            overall_status: 'ready',
            missing_required_count: 0,
            warning_count: 0,
            template_versions: [
              {
                document_type: 'important_matters',
                label: '重要事項説明書',
                template_id: 'template_important',
                template_name: '重要事項説明書 2026年版',
                template_version: 'v2',
                effective_from: '2026-04-01T00:00:00.000Z',
                effective_to: null,
              },
            ],
            checks: [],
          }}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '未作成書類を作成' }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('初回訪問書類の作成に失敗しました'));
    expect(successSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('fails closed when the save mutation returns a malformed 2xx (no success toast, no invalidation)', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const successSpy = vi.spyOn(toast, 'success').mockReturnValue('1' as never);
    const errorSpy = vi.spyOn(toast, 'error').mockReturnValue('1' as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <FirstVisitDocumentsPanel
          orgId="org_1"
          patientId="patient_1"
          cases={[{ id: 'case_1', status: 'active' } as never]}
          documentStatuses={[]}
          documents={[
            {
              id: 'doc_1',
              case_id: 'case_1',
              emergency_contacts: [],
              document_url: null,
              delivered_at: null,
              delivered_to: null,
              created_at: '2026-06-16T00:00:00.000Z',
              updated_at: '2026-06-16T00:00:00.000Z',
              history: [],
            },
          ]}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('履歴操作'), { target: { value: 'replaced' } });
    fireEvent.change(screen.getByLabelText('文書URL'), {
      target: { value: 'https://files.example.test/signed/doc_1.pdf' },
    });
    fireEvent.change(screen.getByLabelText('理由'), { target: { value: '署名者を長女へ訂正' } });

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).not.toHaveProperty('disabled', true);
    fireEvent.submit(saveButton.closest('form')!);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('初回訪問文書の更新に失敗しました'));
    expect(successSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
