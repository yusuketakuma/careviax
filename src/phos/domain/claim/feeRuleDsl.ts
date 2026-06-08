import type {
  ClaimCandidateStatus,
  FeeRuleConditionDsl,
  FeeRuleView,
} from '@/phos/contracts/phos_contracts';

export type FeeRuleFacts = Record<string, string | number | boolean | null | undefined>;

export type FeeRuleEvaluation = {
  matched: boolean;
  missing_evidence_keys: string[];
  candidate_status: ClaimCandidateStatus;
};

export class FeeRuleDslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeRuleDslError';
  }
}

function assertAllowedField(field: string, allowedFields: ReadonlySet<string>): void {
  if (!field || !allowedFields.has(field)) {
    throw new FeeRuleDslError(`Unknown FeeRule DSL field: ${field}`);
  }
}

function comparable(value: unknown): string | number | boolean | null | undefined {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new FeeRuleDslError('FeeRule DSL facts must be primitive values');
}

export function evaluateFeeRuleCondition(
  condition: FeeRuleConditionDsl,
  facts: FeeRuleFacts,
  allowedFields: ReadonlySet<string>,
): boolean {
  switch (condition.op) {
    case 'EXISTS':
      assertAllowedField(condition.field, allowedFields);
      return facts[condition.field] !== null && facts[condition.field] !== undefined;
    case 'EQ':
      assertAllowedField(condition.field, allowedFields);
      return comparable(facts[condition.field]) === condition.value;
    case 'IN':
      assertAllowedField(condition.field, allowedFields);
      return condition.values.includes(comparable(facts[condition.field]) as never);
    case 'GTE':
      assertAllowedField(condition.field, allowedFields);
      {
        const value = facts[condition.field];
        return typeof value === 'number' && value >= condition.value;
      }
    case 'LTE':
      assertAllowedField(condition.field, allowedFields);
      {
        const value = facts[condition.field];
        return typeof value === 'number' && value <= condition.value;
      }
    case 'AND':
      return condition.conditions.every((entry) =>
        evaluateFeeRuleCondition(entry, facts, allowedFields),
      );
    case 'OR':
      return condition.conditions.some((entry) =>
        evaluateFeeRuleCondition(entry, facts, allowedFields),
      );
    case 'NOT':
      return !evaluateFeeRuleCondition(condition.condition, facts, allowedFields);
    default: {
      const unreachable: never = condition;
      throw new FeeRuleDslError(`Unsupported FeeRule DSL operator: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function evaluateFeeRuleCandidate(input: {
  rule: FeeRuleView;
  facts: FeeRuleFacts;
  available_evidence_keys: readonly string[];
  allowed_fields: ReadonlySet<string>;
}): FeeRuleEvaluation {
  const matched = evaluateFeeRuleCondition(input.rule.condition, input.facts, input.allowed_fields);
  const available = new Set(input.available_evidence_keys);
  const missing_evidence_keys = matched
    ? input.rule.evidence_requirements
        .filter((requirement) => requirement.required && !available.has(requirement.evidence_key))
        .map((requirement) => requirement.evidence_key)
    : [];

  return {
    matched,
    missing_evidence_keys,
    candidate_status: !matched
      ? 'EXCLUDED'
      : missing_evidence_keys.length > 0
        ? 'MISSING_EVIDENCE'
        : 'READY',
  };
}
