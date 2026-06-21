type FirstVisitDocumentMutationResponseInput = {
  id: string;
  updated_at: Date | string;
};

function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export function toSafeFirstVisitDocumentMutationResponse(
  document: FirstVisitDocumentMutationResponseInput,
) {
  return {
    id: document.id,
    updated_at: serializeDate(document.updated_at),
  };
}
