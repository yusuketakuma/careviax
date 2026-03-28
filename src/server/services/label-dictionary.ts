import { prisma } from '@/lib/db/client';

type LabelRequest = {
  key: string;
  fallback: string;
};

export async function getLabelDictionaryValues(requests: LabelRequest[]) {
  const uniqueRequests = Array.from(
    new Map(requests.map((request) => [request.key, request])).values()
  );

  const rows = await prisma.labelDictionary.findMany({
    where: {
      key: {
        in: uniqueRequests.map((request) => request.key),
      },
    },
    select: {
      key: true,
      label_ja: true,
    },
  });

  const labelsByKey = new Map(rows.map((row) => [row.key, row.label_ja]));

  return uniqueRequests.reduce<Record<string, string>>((acc, request) => {
    acc[request.key] = labelsByKey.get(request.key) ?? request.fallback;
    return acc;
  }, {});
}

export async function getLabelDictionaryValue(key: string, fallback: string) {
  const labels = await getLabelDictionaryValues([{ key, fallback }]);
  return labels[key];
}
