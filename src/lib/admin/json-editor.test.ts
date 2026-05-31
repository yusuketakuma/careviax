import { describe, expect, it } from 'vitest';
import { parseJsonObjectText } from './json-editor';

describe('admin JSON editor helpers', () => {
  it('parses object-shaped JSON text', () => {
    expect(parseJsonObjectText('{"enabled":true,"threshold":3}')).toEqual({
      enabled: true,
      threshold: 3,
    });
  });

  it('rejects invalid JSON and non-object JSON roots with the provided message', () => {
    expect(() => parseJsonObjectText('{bad-json', '不正です')).toThrow('不正です');
    expect(() => parseJsonObjectText('[]', '不正です')).toThrow('不正です');
    expect(() => parseJsonObjectText('null', '不正です')).toThrow('不正です');
    expect(() => parseJsonObjectText('"string"', '不正です')).toThrow('不正です');
  });
});
