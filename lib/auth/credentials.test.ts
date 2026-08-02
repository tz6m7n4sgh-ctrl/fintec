import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  normaliseEmail,
  validateEmail,
  validatePassword,
  validateSignIn,
  validateSignUp,
} from './credentials';

describe('normaliseEmail', () => {
  it('lowercases and trims, so one address is not two accounts', () => {
    expect(normaliseEmail('  Danial@Example.COM ')).toBe('danial@example.com');
  });
});

describe('validateEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(validateEmail('danial@example.com')).toBeNull();
    expect(validateEmail('first.last+tag@sub.example.co.uk')).toBeNull();
  });

  it('rejects an empty box with an instruction, not a complaint', () => {
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });

  it.each(['danial', 'danial@', '@example.com', 'danial@example', 'a b@example.com'])(
    'rejects %s',
    (bad) => {
      expect(validateEmail(bad)).toMatch(/does not look like/);
    },
  );
});

describe('validatePassword', () => {
  it('accepts one at the minimum length', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('rejects one character below it', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(
      new RegExp(`at least ${PASSWORD_MIN_LENGTH}`),
    );
  });

  it('rejects an empty password', () => {
    expect(validatePassword('')).toBe('Enter a password.');
  });

  /*
   * The case this rule exists for. bcrypt discards everything past 72 bytes, so
   * without the check a longer passphrase and its first 72 bytes would both
   * unlock the same account — a weaker password than the user believes they
   * chose, with nothing on screen to reveal it.
   */
  it('rejects a password longer than bcrypt will hash', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX_BYTES + 1))).toMatch(/too long/);
  });

  it('accepts one exactly at the byte limit', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX_BYTES))).toBeNull();
  });

  /*
   * Bytes, not characters — the reason the limit is measured with TextEncoder.
   * 24 four-byte emoji are 96 bytes but only 48 UTF-16 code units, so a
   * character count would wave this through and bcrypt would quietly cut it.
   */
  it('counts bytes rather than characters', () => {
    const emoji = '🔐'.repeat(24);
    expect(emoji.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(validatePassword(emoji)).toMatch(/too long/);
  });
});

describe('validateSignUp', () => {
  it('passes a well-formed sign-up', () => {
    expect(validateSignUp('danial@example.com', 'correct horse', 'correct horse')).toBeNull();
  });

  it('reports the mismatch when both passwords are otherwise fine', () => {
    expect(validateSignUp('danial@example.com', 'correct horse', 'correct horst')).toBe(
      'The two passwords do not match.',
    );
  });

  /*
   * Order matters. A too-short password that is also mistyped should report the
   * length first — fixing the mismatch alone would just produce a second
   * rejection, which reads as the form moving the goalposts.
   */
  it('reports the length problem before the mismatch', () => {
    expect(validateSignUp('danial@example.com', 'short', 'other')).toMatch(/at least/);
  });

  it('reports the address before anything about the password', () => {
    expect(validateSignUp('not-an-address', 'short', 'other')).toMatch(/does not look like/);
  });
});

describe('validateSignIn', () => {
  it('accepts any non-empty password, because old accounts predate the rules', () => {
    expect(validateSignIn('danial@example.com', 'abc')).toBeNull();
  });

  it('still requires a password to be typed', () => {
    expect(validateSignIn('danial@example.com', '')).toBe('Enter your password.');
  });
});
