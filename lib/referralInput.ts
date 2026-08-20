export function normalizeReferralInput(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const queryRef = url.searchParams.get('ref');
    if (queryRef) return queryRef.trim().toUpperCase();
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length) return pathParts[pathParts.length - 1].trim().toUpperCase();
  } catch {
    // Plain referral code.
  }

  return raw.toUpperCase();
}
