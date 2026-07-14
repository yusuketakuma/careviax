import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { routeCatalog, routeCatalogMetadata } from '@/lib/api/route-catalog';

export const GET = withAuthContext(
  async () => success({ data: routeCatalog, meta: routeCatalogMetadata }),
  {
    permission: 'canAdmin',
    message: 'APIカタログの閲覧権限がありません',
  },
);
