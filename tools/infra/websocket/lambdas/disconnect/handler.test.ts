import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteConnection } from '../shared/connection-store';
import { handler } from './handler';

vi.mock('../shared/connection-store', () => ({
  deleteConnection: vi.fn(),
}));

const deleteConnectionMock = vi.mocked(deleteConnection);

describe('websocket disconnect handler', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the connection record on disconnect', async () => {
    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
        },
      }),
    ).resolves.toEqual({ statusCode: 200 });

    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_1');
  });

  it('rejects malformed disconnect events without deleting unknown records', async () => {
    await expect(handler({ requestContext: {} })).resolves.toEqual({ statusCode: 400 });
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });
});
