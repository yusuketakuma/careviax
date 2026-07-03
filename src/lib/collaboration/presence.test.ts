import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildPresenceQueryKey, buildPresenceUrl, fetchPresenceUsers } from './presence-api-client';
import {
  getCollaboratorColorClass,
  mergePresenceUserUpdate,
  readPresenceUpdateEvent,
  readPresenceUsersResponse,
} from './presence-contract';

describe('presence collaboration contract', () => {
  it('normalizes valid presence users and drops malformed rows', () => {
    expect(
      readPresenceUsersResponse({
        data: [
          {
            user_id: ' user_1 ',
            display_name: ' 田中 ',
            active_field: ' note ',
            updated_at: ' 2026-06-18T00:00:00.000Z ',
          },
          {
            user_id: 'user_2',
            display_name: '佐藤',
            active_field: null,
            updated_at: '2026-06-18T00:01:00.000Z',
          },
          {
            user_id: 123,
            display_name: 'broken',
            active_field: null,
            updated_at: '2026-06-18T00:02:00.000Z',
          },
          {
            user_id: 'user_3',
            display_name: 'broken',
            active_field: { field: 'note' },
            updated_at: '2026-06-18T00:03:00.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        user_id: 'user_1',
        display_name: '田中',
        active_field: 'note',
        updated_at: '2026-06-18T00:00:00.000Z',
      },
      {
        user_id: 'user_2',
        display_name: '佐藤',
        active_field: null,
        updated_at: '2026-06-18T00:01:00.000Z',
      },
    ]);
  });

  it('builds stable query keys and encoded URLs', () => {
    expect(buildPresenceQueryKey('visit record', 'patient/1', 'org_1')).toEqual([
      'presence',
      'visit record',
      'patient/1',
      'org_1',
    ]);
    expect(buildPresenceUrl('visit record', 'patient/1')).toBe(
      '/api/presence?entity_type=visit%20record&entity_id=patient%2F1',
    );
  });

  it('assigns collaborator colors deterministically', () => {
    expect(getCollaboratorColorClass('user_1')).toBe(getCollaboratorColorClass('user_1'));
    expect(getCollaboratorColorClass('')).toBe('bg-blue-500');
  });

  it('reads matching presence update events and ignores unrelated payloads', () => {
    expect(
      readPresenceUpdateEvent(
        {
          type: 'presence_update',
          entity_type: 'patient',
          entity_id: 'patient_1',
          user_id: ' user_1 ',
          display_name: ' 田中 ',
          active_field: null,
          updated_at: ' 2026-06-18T00:00:00.000Z ',
        },
        'patient',
        'patient_1',
      ),
    ).toEqual({
      user_id: 'user_1',
      display_name: '田中',
      active_field: null,
      updated_at: '2026-06-18T00:00:00.000Z',
    });
    expect(
      readPresenceUpdateEvent(
        {
          type: 'presence_update',
          entity_type: 'patient',
          entity_id: 'patient_2',
          user_id: 'user_1',
          display_name: '田中',
          active_field: null,
          updated_at: '2026-06-18T00:00:00.000Z',
        },
        'patient',
        'patient_1',
      ),
    ).toBeNull();
  });

  it('merges presence updates without reordering existing users', () => {
    expect(
      mergePresenceUserUpdate(
        [
          {
            user_id: 'user_1',
            display_name: '古い名前',
            active_field: null,
            updated_at: '2026-06-18T00:00:00.000Z',
          },
          {
            user_id: 'user_2',
            display_name: '佐藤',
            active_field: null,
            updated_at: '2026-06-18T00:00:01.000Z',
          },
        ],
        {
          user_id: 'user_1',
          display_name: '田中',
          active_field: 'note',
          updated_at: '2026-06-18T00:00:02.000Z',
        },
      ),
    ).toEqual([
      {
        user_id: 'user_1',
        display_name: '田中',
        active_field: 'note',
        updated_at: '2026-06-18T00:00:02.000Z',
      },
      {
        user_id: 'user_2',
        display_name: '佐藤',
        active_field: null,
        updated_at: '2026-06-18T00:00:01.000Z',
      },
    ]);
  });

  it('fetches presence users with org header and returns [] for denied reads', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = vi.fn(async () => new Response(null, { status: 403 })) as typeof fetch;

      await expect(
        fetchPresenceUsers({ orgId: 'org_1', entityType: 'patient', entityId: 'patient_1' }),
      ).resolves.toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/presence?entity_type=patient&entity_id=patient_1',
        {
          headers: { 'x-org-id': 'org_1' },
        },
      );

      global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
      await expect(
        fetchPresenceUsers({ orgId: 'org_1', entityType: 'patient', entityId: 'missing' }),
      ).resolves.toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('keeps visual collaboration atoms on the pure presence contract', () => {
    for (const relativePath of [
      'src/components/features/collaboration/field-lock-indicator.tsx',
      'src/components/features/collaboration/presence-avatars.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source).not.toContain('@/lib/collaboration/presence-api-client');
      expect(source).not.toContain("@/lib/collaboration/presence'");
      expect(source).toContain('@/lib/collaboration/presence-contract');
    }
  });
});
