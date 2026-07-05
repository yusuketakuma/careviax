import { z } from 'zod';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildDrugMastersApiPath } from '@/lib/drug-masters/api-paths';

export const drugMasterSuggestionSchema = z.object({
  id: z.string(),
  yj_code: z.string(),
  drug_name: z.string(),
  drug_name_kana: z.string().nullable(),
  generic_name: z.string().nullable(),
  drug_price: z.number().nullable(),
  unit: z.string().nullable(),
  dosage_form: z.string().nullable(),
  manufacturer: z.string().nullable(),
  is_generic: z.boolean(),
  is_narcotic: z.boolean(),
  is_psychotropic: z.boolean(),
  max_administration_days: z.number().nullable(),
});

export type DrugMasterSuggestion = z.infer<typeof drugMasterSuggestionSchema>;

const drugMasterSuggestionsResponseSchema = z.object({
  data: z.array(drugMasterSuggestionSchema).default([]),
});

export async function fetchDrugMasterSuggestions(args: {
  query: string;
  orgId: string;
  fetchImpl?: typeof fetch;
}) {
  const query = args.query.trim();
  if (query.length < 2) return [];

  const params = new URLSearchParams({
    q: query,
    limit: '10',
    includeTotal: 'false',
  });
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(buildDrugMastersApiPath(params), {
    headers: buildOrgHeaders(args.orgId),
  });
  if (!response.ok) return [];

  try {
    const payload = await readApiJson<z.infer<typeof drugMasterSuggestionsResponseSchema>>(
      response,
      {
        fallbackMessage: '医薬品候補の取得に失敗しました',
        schema: drugMasterSuggestionsResponseSchema,
      },
    );
    return payload.data;
  } catch {
    return [];
  }
}
