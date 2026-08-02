import { describe, expect, it } from 'vitest';
import { parseOtpInput } from './otp';

/**
 * The point of these is narrow but load-bearing: whether a first-time user can
 * get into the app at all depends on this function reading whatever Supabase
 * decided to email them. The stock email template sends a link, the form asks
 * for a code, and this is what reconciles the two.
 */

const STOCK_CONFIRMATION_URL =
  'https://oliabzajqveerlgzialv.supabase.co/auth/v1/verify?token=pkce_9f8e7d6c5b4a&type=magiclink&redirect_to=https://fintec-wheat.vercel.app/auth/confirm';

const CUSTOM_TEMPLATE_URL =
  'https://fintec-wheat.vercel.app/auth/confirm?token_hash=abc123def456&type=email';

describe('parseOtpInput', () => {
  it('reads a six-digit code', () => {
    expect(parseOtpInput('123456')).toEqual({ kind: 'code', token: '123456' });
  });

  it('tolerates the whitespace that comes with copy and paste', () => {
    expect(parseOtpInput('  123456 \n')).toEqual({ kind: 'code', token: '123456' });
  });

  it('reads the stock ConfirmationURL, whose parameter is `token`', () => {
    // This is the case that matters most: it is what an untouched Supabase
    // project sends, so it is what a real first user will actually paste.
    expect(parseOtpInput(STOCK_CONFIRMATION_URL)).toEqual({
      kind: 'hash',
      tokenHash: 'pkce_9f8e7d6c5b4a',
      type: 'magiclink',
    });
  });

  it('reads the documented custom template, whose parameter is `token_hash`', () => {
    expect(parseOtpInput(CUSTOM_TEMPLATE_URL)).toEqual({
      kind: 'hash',
      tokenHash: 'abc123def456',
      type: 'email',
    });
  });

  it('prefers token_hash when a link somehow carries both', () => {
    const both = 'https://example.com/auth/confirm?token=aaa&token_hash=bbb&type=email';
    expect(parseOtpInput(both)).toMatchObject({ tokenHash: 'bbb' });
  });

  it('falls back to type=email rather than forwarding a bogus type', () => {
    // An unknown type is rejected by the auth server with a message that tells
    // the user nothing they can act on, so it never gets sent.
    const odd = 'https://example.com/auth/confirm?token_hash=xyz&type=not-a-real-type';
    expect(parseOtpInput(odd)).toEqual({ kind: 'hash', tokenHash: 'xyz', type: 'email' });
  });

  it('defaults the type when the link omits it', () => {
    expect(parseOtpInput('https://example.com/auth/confirm?token_hash=xyz')).toEqual({
      kind: 'hash',
      tokenHash: 'xyz',
      type: 'email',
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['prose', 'click the button in your email'],
    ['a link with no token at all', 'https://fintec-wheat.vercel.app/auth/confirm'],
    ['a malformed URL', 'https://'],
  ])('returns null for %s', (_label, input) => {
    expect(parseOtpInput(input)).toBeNull();
  });

  it('returns null for a PKCE code link, which cannot be pasted across browsers', () => {
    // Exchanging ?code= needs the verifier the *requesting* browser stored.
    // Accepting it here would fail confusingly; /auth/confirm handles the click
    // path instead, where the browser is right by construction.
    expect(parseOtpInput('https://fintec-wheat.vercel.app/auth/confirm?code=abc-123')).toBeNull();
  });
});
