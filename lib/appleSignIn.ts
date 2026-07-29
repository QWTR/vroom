export type AppleFullName = {
  givenName?: string | null;
  familyName?: string | null;
  middleName?: string | null;
  namePrefix?: string | null;
  nameSuffix?: string | null;
  nickname?: string | null;
};

export type AppleCredentialPayload = {
  identityToken: string | null;
  authorizationCode: string | null;
  user: string;
  fullName: AppleFullName | null;
  email: string | null;
  state: string | null;
};

export function isAppleSignInCanceled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === 'ERR_REQUEST_CANCELED';
}

export function assertAppleState(expected: string, received: string | null): void {
  if (!received || received !== expected) {
    throw new Error('Nieprawidłowy stan odpowiedzi Apple.');
  }
}

export function buildAppleSignInBody(
  credential: AppleCredentialPayload,
  nonce: string,
  acceptUgcTerms: boolean,
) {
  if (!credential.identityToken) {
    throw new Error('Apple nie zwróciło tokenu tożsamości.');
  }
  if (!nonce) {
    throw new Error('Brak zabezpieczenia nonce.');
  }

  return {
    identityToken: credential.identityToken,
    authorizationCode: credential.authorizationCode,
    appleUser: credential.user,
    email: credential.email,
    fullName: credential.fullName,
    nonce,
    acceptUgcTerms,
  };
}
