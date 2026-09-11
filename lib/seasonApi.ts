const unavailable = 'Nie udało się połączyć z usługą sezonów. Spróbuj ponownie za chwilę.';

export async function seasonRequest(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers } });
    if (response.status === 401) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(unavailable); }
    if (!data || typeof data !== 'object') throw new Error(unavailable);
    if (!response.ok) {
      const message = response.status >= 500 ? unavailable : typeof data.error === 'string' ? data.error : unavailable;
      throw Object.assign(new Error(message), { code: data.code });
    }
    return data;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error instanceof TypeError)) throw new Error(unavailable);
    throw error;
  } finally { clearTimeout(timer); }
}

export function hasTimedPassOffer(pass: unknown): boolean {
  if (!pass || typeof pass !== 'object') return false;
  const offer = pass as Record<string, unknown>;
  return typeof offer.durationDays === 'number' && Number.isInteger(offer.durationDays) && offer.durationDays > 0
    && typeof offer.priceGross === 'number' && Number.isInteger(offer.priceGross) && offer.priceGross >= 0
    && typeof offer.currency === 'string' && /^[a-z]{3}$/i.test(offer.currency);
}
