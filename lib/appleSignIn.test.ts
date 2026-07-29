import { describe, expect, it } from 'vitest';
import {
  assertAppleState,
  buildAppleSignInBody,
  isAppleSignInCanceled,
} from './appleSignIn';

const credential = {
  identityToken: 'signed.identity.token',
  authorizationCode: 'single-use-code',
  user: 'apple-user-id',
  email: 'hidden@privaterelay.appleid.com',
  fullName: {
    givenName: 'Jan',
    familyName: 'Kowalski',
  },
  state: 'state-1',
};

describe('Apple Sign In client contract', () => {
  it('sends the signed token, nonce and first-login profile to the backend', () => {
    expect(buildAppleSignInBody(credential, 'nonce-1', true)).toEqual({
      identityToken: 'signed.identity.token',
      authorizationCode: 'single-use-code',
      appleUser: 'apple-user-id',
      email: 'hidden@privaterelay.appleid.com',
      fullName: {
        givenName: 'Jan',
        familyName: 'Kowalski',
      },
      nonce: 'nonce-1',
      acceptUgcTerms: true,
    });
  });

  it('supports subsequent logins without name or email from the native credential', () => {
    expect(buildAppleSignInBody({
      ...credential,
      email: null,
      fullName: null,
    }, 'nonce-2', true)).toMatchObject({
      email: null,
      fullName: null,
      nonce: 'nonce-2',
    });
  });

  it('rejects missing identity tokens and mismatched state', () => {
    expect(() => buildAppleSignInBody({
      ...credential,
      identityToken: null,
    }, 'nonce-3', true)).toThrow('tokenu tożsamości');
    expect(() => assertAppleState('expected', 'different')).toThrow('stan odpowiedzi');
  });

  it('treats only the documented Expo cancellation code as cancellation', () => {
    expect(isAppleSignInCanceled({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(isAppleSignInCanceled({ code: 'ERR_REQUEST_FAILED' })).toBe(false);
    expect(isAppleSignInCanceled(null)).toBe(false);
  });
});
