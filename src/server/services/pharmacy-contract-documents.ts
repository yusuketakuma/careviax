import { createHash } from 'node:crypto';
import { formatNullableUtcDateKey } from '@/lib/date-key';

type JsonRecord = Record<string, unknown>;

export type PharmacyContractDocumentTemplate = {
  id: string;
  name: string;
  format: string;
  version: number;
  content: unknown;
};

export type PharmacyContractDocumentFeeRule = {
  billing_model: string;
  unit_price: number | null;
  addon_rules?: unknown;
  expense_rules?: unknown;
  tax_category: string;
  tax_rate_bp: number | null;
  rounding_rule: string | null;
};

export type PharmacyContractDocumentVersion = {
  id: string;
  version_no: number;
  status: string;
  effective_from: Date | null;
  effective_to: Date | null;
  fee_rules?: PharmacyContractDocumentFeeRule[];
};

export type PharmacyContractDocumentContract = {
  id: string;
  partnership_id: string;
  status: string;
  effective_from: Date | null;
  effective_to: Date | null;
  closing_day: number | null;
  payment_due_rule: unknown;
  partnership: {
    id: string;
    status: string;
    base_site: { id: string; name: string } | null;
    partner_pharmacy: { id: string; name: string; status: string } | null;
  };
};

export type PharmacyContractTemplateArticle = {
  article_no: number;
  title: string;
  body: string;
};

export type PharmacyContractDocumentPreview = {
  document_type: string;
  hash_value: string;
  rendered_text: string;
  snapshot: {
    document_type: string;
    generated_at: string;
    template: {
      id: string;
      name: string;
      version: number;
      format: string;
    };
    contract: {
      id: string;
      status: string;
      partnership_id: string;
      effective_from: string;
      effective_to: string | null;
      closing_day: number | null;
      payment_due_rule: unknown;
    };
    version: {
      id: string;
      version_no: number;
      status: string;
      effective_from: string;
      effective_to: string | null;
    };
    parties: {
      base_pharmacy: { id: string | null; name: string | null };
      partner_pharmacy: { id: string | null; name: string | null };
    };
    fee_schedule: {
      billing_model: string;
      unit_price: number | null;
      tax_category: string;
      tax_rate_bp: number | null;
      rounding_rule: string | null;
      has_addon_rules: boolean;
      has_expense_rules: boolean;
    };
    articles: PharmacyContractTemplateArticle[];
  };
};

type TemplateValidationResult =
  | { ok: true; articles: PharmacyContractTemplateArticle[] }
  | { ok: false; missingArticleNumbers: number[] };

const REQUIRED_ARTICLE_NUMBERS = Array.from({ length: 23 }, (_value, index) => index + 1);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function readTemplateText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const lines = value.map(readString).filter((line): line is string => Boolean(line));
    return lines.length > 0 ? lines.join('\n') : null;
  }
  return null;
}

function readArticleNumberFromKey(key: string) {
  const matched = key.match(/\d+/);
  return matched ? Number(matched[0]) : null;
}

function normalizeArticleFromRecord(raw: unknown, fallbackNo?: number | null) {
  if (!isRecord(raw)) return null;
  const articleNo =
    readNumber(raw.article_no) ??
    readNumber(raw.articleNo) ??
    readNumber(raw.number) ??
    readNumber(raw.no) ??
    fallbackNo ??
    null;
  if (!articleNo) return null;

  const body =
    readTemplateText(raw.body) ?? readTemplateText(raw.content) ?? readTemplateText(raw.text);
  if (!body) return null;

  return {
    article_no: articleNo,
    title: readString(raw.title) ?? `第${articleNo}条`,
    body,
  } satisfies PharmacyContractTemplateArticle;
}

function readRawArticles(content: JsonRecord) {
  const articles = content.articles;
  if (Array.isArray(articles)) return articles;
  if (isRecord(articles)) {
    return Object.entries(articles).map(([key, value]) => ({
      key,
      value,
      articleNo: readArticleNumberFromKey(key),
    }));
  }
  return [];
}

export function normalizePharmacyContractTemplateContent(
  content: unknown,
): TemplateValidationResult {
  if (!isRecord(content)) return { ok: false, missingArticleNumbers: REQUIRED_ARTICLE_NUMBERS };

  const normalized = readRawArticles(content)
    .map((raw) => {
      if (isRecord(raw) && 'value' in raw) {
        return normalizeArticleFromRecord(raw.value, readNumber(raw.articleNo));
      }
      return normalizeArticleFromRecord(raw);
    })
    .filter((article): article is PharmacyContractTemplateArticle => Boolean(article))
    .sort((left, right) => left.article_no - right.article_no);

  const articleNumbers = new Set(normalized.map((article) => article.article_no));
  const missingArticleNumbers = REQUIRED_ARTICLE_NUMBERS.filter(
    (articleNo) => !articleNumbers.has(articleNo),
  );

  if (missingArticleNumbers.length > 0) return { ok: false, missingArticleNumbers };
  return {
    ok: true,
    articles: REQUIRED_ARTICLE_NUMBERS.map((articleNo) =>
      normalized.find((article) => article.article_no === articleNo),
    ).filter((article): article is PharmacyContractTemplateArticle => Boolean(article)),
  };
}

function formatDateKey(date: Date | null) {
  return formatNullableUtcDateKey(date);
}

function formatAmount(value: number | null) {
  return value == null ? '未設定' : `${value.toLocaleString('ja-JP')}円`;
}

function formatTaxRate(value: number | null) {
  return value == null ? '未設定' : `${(value / 100).toLocaleString('ja-JP')}%`;
}

function buildPlaceholderValues(args: {
  contract: PharmacyContractDocumentContract;
  version: PharmacyContractDocumentVersion;
  feeRule: PharmacyContractDocumentFeeRule;
}) {
  const baseSite = args.contract.partnership.base_site;
  const partnerPharmacy = args.contract.partnership.partner_pharmacy;
  return {
    base_pharmacy_name: baseSite?.name ?? '',
    partner_pharmacy_name: partnerPharmacy?.name ?? '',
    contract_id: args.contract.id,
    contract_version_no: String(args.version.version_no),
    effective_from: formatDateKey(args.version.effective_from) ?? '',
    effective_to: formatDateKey(args.version.effective_to) ?? '',
    billing_model: args.feeRule.billing_model,
    unit_price: formatAmount(args.feeRule.unit_price),
    tax_rate: formatTaxRate(args.feeRule.tax_rate_bp),
    tax_category: args.feeRule.tax_category,
    closing_day: args.contract.closing_day ? String(args.contract.closing_day) : '',
  } satisfies Record<string, string>;
}

function applyPlaceholders(text: string, values: Record<string, string>) {
  return text.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_match, key: string) => values[key] ?? '',
  );
}

function buildFeeSchedule(rule: PharmacyContractDocumentFeeRule) {
  return {
    billing_model: rule.billing_model,
    unit_price: rule.unit_price,
    tax_category: rule.tax_category,
    tax_rate_bp: rule.tax_rate_bp,
    rounding_rule: rule.rounding_rule,
    has_addon_rules: rule.addon_rules !== undefined && rule.addon_rules !== null,
    has_expense_rules: rule.expense_rules !== undefined && rule.expense_rules !== null,
  };
}

function renderDocument(snapshot: PharmacyContractDocumentPreview['snapshot']) {
  const lines = [
    `${snapshot.template.name} v${snapshot.template.version}`,
    '',
    `基幹薬局: ${snapshot.parties.base_pharmacy.name ?? '未設定'}`,
    `協力薬局: ${snapshot.parties.partner_pharmacy.name ?? '未設定'}`,
    `契約版: v${snapshot.version.version_no} (${snapshot.version.effective_from} - ${
      snapshot.version.effective_to ?? '期限なし'
    })`,
    '',
    '費用条件表',
    `課金方式: ${snapshot.fee_schedule.billing_model}`,
    `単価: ${formatAmount(snapshot.fee_schedule.unit_price)}`,
    `税区分: ${snapshot.fee_schedule.tax_category}`,
    `税率: ${formatTaxRate(snapshot.fee_schedule.tax_rate_bp)}`,
    `端数処理: ${snapshot.fee_schedule.rounding_rule ?? '未設定'}`,
    '',
    ...snapshot.articles.flatMap((article) => [
      `第${article.article_no}条 ${article.title}`,
      article.body,
      '',
    ]),
  ];
  return lines.join('\n').trimEnd();
}

function hashDocument(snapshot: PharmacyContractDocumentPreview['snapshot'], renderedText: string) {
  return createHash('sha256')
    .update(JSON.stringify({ snapshot, rendered_text: renderedText }))
    .digest('hex');
}

export function buildPharmacyContractDocumentPreview(args: {
  documentType: string;
  generatedAt: Date;
  template: PharmacyContractDocumentTemplate;
  contract: PharmacyContractDocumentContract;
  version: PharmacyContractDocumentVersion;
}):
  | { ok: true; preview: PharmacyContractDocumentPreview }
  | { ok: false; missingArticleNumbers: number[] } {
  const normalized = normalizePharmacyContractTemplateContent(args.template.content);
  if (!normalized.ok) return normalized;

  const feeRule =
    args.version.fee_rules?.find((rule) => rule != null) ??
    ({
      billing_model: 'free',
      unit_price: null,
      tax_category: 'tax_pending',
      tax_rate_bp: null,
      rounding_rule: null,
    } satisfies PharmacyContractDocumentFeeRule);
  const placeholders = buildPlaceholderValues({
    contract: args.contract,
    version: args.version,
    feeRule,
  });
  const articles = normalized.articles.map((article) => ({
    article_no: article.article_no,
    title: applyPlaceholders(article.title, placeholders),
    body: applyPlaceholders(article.body, placeholders),
  }));

  const snapshot = {
    document_type: args.documentType,
    generated_at: args.generatedAt.toISOString(),
    template: {
      id: args.template.id,
      name: args.template.name,
      version: args.template.version,
      format: args.template.format,
    },
    contract: {
      id: args.contract.id,
      status: args.contract.status,
      partnership_id: args.contract.partnership_id,
      effective_from: formatDateKey(args.contract.effective_from) ?? '',
      effective_to: formatDateKey(args.contract.effective_to),
      closing_day: args.contract.closing_day,
      payment_due_rule: args.contract.payment_due_rule,
    },
    version: {
      id: args.version.id,
      version_no: args.version.version_no,
      status: args.version.status,
      effective_from: formatDateKey(args.version.effective_from) ?? '',
      effective_to: formatDateKey(args.version.effective_to),
    },
    parties: {
      base_pharmacy: {
        id: args.contract.partnership.base_site?.id ?? null,
        name: args.contract.partnership.base_site?.name ?? null,
      },
      partner_pharmacy: {
        id: args.contract.partnership.partner_pharmacy?.id ?? null,
        name: args.contract.partnership.partner_pharmacy?.name ?? null,
      },
    },
    fee_schedule: buildFeeSchedule(feeRule),
    articles,
  } satisfies PharmacyContractDocumentPreview['snapshot'];
  const renderedText = renderDocument(snapshot);

  return {
    ok: true,
    preview: {
      document_type: args.documentType,
      hash_value: hashDocument(snapshot, renderedText),
      rendered_text: renderedText,
      snapshot,
    },
  };
}
