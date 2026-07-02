'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ActionRail } from '@/components/ui/action-rail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';

type ContactRow = {
  id?: string;
  relation:
    | 'self'
    | 'spouse'
    | 'child'
    | 'parent'
    | 'sibling'
    | 'care_manager'
    | 'physician'
    | 'nurse'
    | 'facility_staff'
    | 'other';
  name: string;
  phone: string;
  email: string;
  fax: string;
  organization_name: string;
  department: string;
  address: string;
  is_primary: boolean;
  is_emergency_contact: boolean;
  notes: string;
};

type ReliabilityWarning = {
  code: string;
  severity: 'warning';
  message: string;
};

type ContactSaveResponse = {
  warnings?: ReliabilityWarning[];
  metadata?: {
    expected_updated_at?: string | null;
  };
};

const relationLabel: Record<ContactRow['relation'], string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  care_manager: 'ケアマネ',
  physician: '医師',
  nurse: '看護師',
  facility_staff: '施設職員',
  other: 'その他',
};

const CONTACT_DELETE_DISABLED_REASON_ID = 'patient-contact-delete-disabled-reason';
const CONTACT_SAVE_EMPTY_REASON_ID = 'patient-contact-save-empty-reason';
const CONTACT_SAVE_EMPTY_REASON = '保存するには連絡先の氏名を入力してください。';
const CONTACT_SAVE_STALE_REASON = '患者情報を再読み込みしてから連絡先を保存してください。';

export function PatientContactsPanel({
  patientId,
  orgId,
  initialContacts,
  initialExpectedUpdatedAt = null,
}: {
  patientId: string;
  orgId: string;
  initialExpectedUpdatedAt?: string | null;
  initialContacts: Array<{
    id: string;
    relation: ContactRow['relation'];
    name: string;
    phone: string | null;
    email: string | null;
    fax: string | null;
    organization_name: string | null;
    department: string | null;
    address: string | null;
    is_primary: boolean;
    is_emergency_contact: boolean;
    notes: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [contacts, setContacts] = useState<ContactRow[]>(
    initialContacts.length > 0
      ? initialContacts.map((contact) => ({
          id: contact.id,
          relation: contact.relation,
          name: contact.name,
          phone: contact.phone ?? '',
          email: contact.email ?? '',
          fax: contact.fax ?? '',
          organization_name: contact.organization_name ?? '',
          department: contact.department ?? '',
          address: contact.address ?? '',
          is_primary: contact.is_primary,
          is_emergency_contact: contact.is_emergency_contact,
          notes: contact.notes ?? '',
        }))
      : [
          {
            relation: 'self',
            name: '',
            phone: '',
            email: '',
            fax: '',
            organization_name: '',
            department: '',
            address: '',
            is_primary: true,
            is_emergency_contact: false,
            notes: '',
          },
        ],
  );
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(initialExpectedUpdatedAt);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!expectedUpdatedAt) {
        throw new Error(CONTACT_SAVE_STALE_REASON);
      }
      const res = await fetch(buildPatientApiPath(patientId, '/contacts'), {
        method: 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          expected_updated_at: expectedUpdatedAt,
          contacts: contacts
            .filter((contact) => contact.name.trim())
            .map((contact) => ({
              relation: contact.relation,
              name: contact.name.trim(),
              phone: contact.phone || undefined,
              email: contact.email || undefined,
              fax: contact.fax || undefined,
              organization_name: contact.organization_name || undefined,
              department: contact.department || undefined,
              address: contact.address || undefined,
              is_primary: contact.is_primary,
              is_emergency_contact: contact.is_emergency_contact,
              notes: contact.notes || undefined,
            })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((payload as { message?: string }).message ?? '連絡先の保存に失敗しました');
      }
      return payload as ContactSaveResponse;
    },
    onSuccess: async (payload) => {
      if (payload.metadata?.expected_updated_at) {
        setExpectedUpdatedAt(payload.metadata.expected_updated_at);
      }
      toast.success('連絡先を更新しました');
      for (const warning of payload.warnings ?? []) {
        toast.warning(warning.message);
      }
      await invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId }));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '連絡先の保存に失敗しました');
    },
  });
  const hasPersistableContact = contacts.some((contact) => contact.name.trim());
  const saveDisabledReason = !hasPersistableContact
    ? CONTACT_SAVE_EMPTY_REASON
    : expectedUpdatedAt
      ? null
      : CONTACT_SAVE_STALE_REASON;

  return (
    <Card data-testid="patient-contacts-panel">
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">患者・家族連絡先</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {contacts
            .filter((contact) => contact.name.trim())
            .map((contact, index) => (
              <span key={`${contact.relation}-${contact.name}-${index}`}>
                {relationLabel[contact.relation]}: {contact.name}
              </span>
            ))}
        </div>

        {contacts.map((contact, index) => (
          <div key={contact.id ?? `contact-${index}`} className="rounded-lg border p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="関係">
                <Select
                  value={contact.relation}
                  onValueChange={(value) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, relation: value as ContactRow['relation'] }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label={`連絡先${index + 1}件目の関係`}>
                    <SelectValue>{relationLabel[contact.relation]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(relationLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="氏名">
                <Input
                  aria-label={`連絡先${index + 1}件目の氏名`}
                  value={contact.name}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="電話番号">
                <Input
                  aria-label={`連絡先${index + 1}件目の電話番号`}
                  value={contact.phone}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, phone: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="メール">
                <Input
                  aria-label={`連絡先${index + 1}件目のメール`}
                  value={contact.email}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, email: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="組織名">
                <Input
                  aria-label={`連絡先${index + 1}件目の組織名`}
                  value={contact.organization_name}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, organization_name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="部署">
                <Input
                  aria-label={`連絡先${index + 1}件目の部署`}
                  value={contact.department}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, department: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="FAX">
                <Input
                  aria-label={`連絡先${index + 1}件目のFAX`}
                  value={contact.fax}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, fax: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="住所">
                <Input
                  aria-label={`連絡先${index + 1}件目の住所`}
                  value={contact.address}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, address: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="メモ" className="md:col-span-2">
                <Textarea
                  aria-label={`連絡先${index + 1}件目のメモ`}
                  rows={2}
                  value={contact.notes}
                  onChange={(event) =>
                    setContacts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, notes: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={contact.is_primary}
                    onCheckedChange={(checked) =>
                      setContacts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, is_primary: Boolean(checked) } : item,
                        ),
                      )
                    }
                  />
                  <span>主要連絡先</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={contact.is_emergency_contact}
                    onCheckedChange={(checked) =>
                      setContacts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, is_emergency_contact: Boolean(checked) }
                            : item,
                        ),
                      )
                    }
                  />
                  <span>緊急連絡先</span>
                </label>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`連絡先${index + 1}件目を削除`}
                aria-describedby={
                  contacts.length === 1 ? CONTACT_DELETE_DISABLED_REASON_ID : undefined
                }
                onClick={() =>
                  setContacts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
                disabled={contacts.length === 1}
              >
                <Trash2 className="mr-1 size-4" />
                削除
              </Button>
              {contacts.length === 1 ? (
                <p id={CONTACT_DELETE_DISABLED_REASON_ID} className="text-xs text-muted-foreground">
                  連絡先は最低1件必要です。
                </p>
              ) : null}
            </div>
          </div>
        ))}

        <ActionRail align="between">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setContacts((current) => [
                ...current,
                {
                  relation: 'other',
                  name: '',
                  phone: '',
                  email: '',
                  fax: '',
                  organization_name: '',
                  department: '',
                  address: '',
                  is_primary: false,
                  is_emergency_contact: false,
                  notes: '',
                },
              ])
            }
          >
            <Plus className="mr-1 size-4" />
            行追加
          </Button>
          {saveDisabledReason ? (
            <p id={CONTACT_SAVE_EMPTY_REASON_ID} className="text-xs text-muted-foreground">
              {saveDisabledReason}
            </p>
          ) : null}
          <Button
            type="button"
            aria-describedby={saveDisabledReason ? CONTACT_SAVE_EMPTY_REASON_ID : undefined}
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || Boolean(saveDisabledReason)}
          >
            {saveMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </ActionRail>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
