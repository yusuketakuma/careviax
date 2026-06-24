import { describe, expect, it } from 'vitest';
import { buildOrgHeaders, buildOrgJsonHeaders } from './org-headers';

describe('buildOrgHeaders', () => {
  it('x-org-id を関数引数の値で canonical に1つだけ含む', () => {
    const headers = buildOrgHeaders('org_1');
    expect(headers['x-org-id']).toBe('org_1');
    const orgKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'x-org-id');
    expect(orgKeys).toEqual(['x-org-id']);
  });

  it('衝突しない extra はマージする', () => {
    const headers = buildOrgHeaders('org_1', { Accept: 'application/pdf' });
    expect(headers).toEqual({ 'x-org-id': 'org_1', Accept: 'application/pdf' });
  });

  it("extra に小文字 'x-org-id' があれば RangeError", () => {
    expect(() => buildOrgHeaders('org_1', { 'x-org-id': 'evil' })).toThrow(RangeError);
  });

  it("extra に大文字ケーシング 'X-Org-Id' があっても RangeError", () => {
    expect(() => buildOrgHeaders('org_1', { 'X-Org-Id': 'evil' })).toThrow(RangeError);
  });
});

describe('buildOrgJsonHeaders', () => {
  it('Content-Type: application/json と x-org-id を必ず含む', () => {
    const headers = buildOrgJsonHeaders('org_1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-org-id']).toBe('org_1');
    const ctKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'content-type');
    expect(ctKeys).toEqual(['Content-Type']);
  });

  it('衝突しない extra はマージする', () => {
    const headers = buildOrgJsonHeaders('org_1', { Accept: 'application/json' });
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      Accept: 'application/json',
    });
  });

  it("extra の 'content-type' / 'Content-Type' は RangeError", () => {
    expect(() => buildOrgJsonHeaders('org_1', { 'content-type': 'text/plain' })).toThrow(
      RangeError,
    );
    expect(() => buildOrgJsonHeaders('org_1', { 'Content-Type': 'text/plain' })).toThrow(
      RangeError,
    );
  });

  it("extra の 'x-org-id' も RangeError", () => {
    expect(() => buildOrgJsonHeaders('org_1', { 'x-org-id': 'evil' })).toThrow(RangeError);
  });
});
