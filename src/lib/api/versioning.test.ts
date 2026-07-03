import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { deprecationCatalog, type DeprecationEntry } from './deprecation-catalog';
import { applyDeprecationHeaders, isDeprecatedRoute } from './versioning';

const sampleEntry: DeprecationEntry = {
  routePath: '/api/patients/:id/legacy-summary',
  methods: ['GET'],
  connectorType: 'internal',
  deprecatedAt: '2026-07-01',
  sunsetDate: '2027-01-01',
  migrationGuideUrl: 'https://example.internal/docs/migrate-legacy-summary',
};

describe('applyDeprecationHeaders', () => {
  it('does not set any X-API-* headers when the route is not in the catalog', () => {
    const response = NextResponse.json({ ok: true });
    const result = applyDeprecationHeaders(response, '/api/patients/:id/overview', 'GET');

    expect(result.headers.get('X-API-Version')).toBeNull();
    expect(result.headers.get('X-API-Deprecated')).toBeNull();
    expect(result.headers.get('X-API-Sunset-Date')).toBeNull();
  });

  it('sets X-API-Version / X-API-Deprecated / X-API-Sunset-Date for a cataloged route', () => {
    deprecationCatalog.push(sampleEntry);
    try {
      const response = NextResponse.json({ ok: true });
      const result = applyDeprecationHeaders(
        response,
        '/api/patients/:id/legacy-summary',
        'GET',
      );

      expect(result.headers.get('X-API-Version')).toBe('1');
      expect(result.headers.get('X-API-Deprecated')).toBe('true');
      expect(result.headers.get('X-API-Sunset-Date')).toBe('2027-01-01');
    } finally {
      deprecationCatalog.pop();
    }
  });

  it('does not set headers when the method does not match the cataloged entry', () => {
    deprecationCatalog.push(sampleEntry);
    try {
      const response = NextResponse.json({ ok: true });
      const result = applyDeprecationHeaders(
        response,
        '/api/patients/:id/legacy-summary',
        'POST',
      );

      expect(result.headers.get('X-API-Deprecated')).toBeNull();
    } finally {
      deprecationCatalog.pop();
    }
  });

  it('returns the same response instance (mutates in place, does not clone)', () => {
    const response = NextResponse.json({ ok: true });
    const result = applyDeprecationHeaders(response, '/api/not-cataloged', 'GET');
    expect(result).toBe(response);
  });
});

describe('isDeprecatedRoute', () => {
  it('returns false for a route not in the catalog', () => {
    expect(isDeprecatedRoute('/api/patients/:id/overview')).toBe(false);
  });

  it('returns true for a cataloged route + method', () => {
    deprecationCatalog.push(sampleEntry);
    try {
      expect(isDeprecatedRoute('/api/patients/:id/legacy-summary', 'GET')).toBe(true);
    } finally {
      deprecationCatalog.pop();
    }
  });
});
