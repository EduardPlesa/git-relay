import { describe, it, expect } from 'vitest';
import { generateToken } from './pairing.js';

describe('generateToken', () => {
  it('returns a non-empty string', () => {
    const token = generateToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('returns a different token on each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it('only contains URL-safe base64 characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
