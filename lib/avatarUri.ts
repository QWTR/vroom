const AVATAR_BUST_STORAGE_KEY = 'avatarCacheBust';

/** Nowe avatary mają timestamp w nazwie pliku — nie wymagają bust. */
export function avatarUrlHasVersion(url: string): boolean {
  const base = url.split('?')[0];
  return /avatar_\d+_\d+\.(jpe?g|png|webp)$/i.test(base);
}

export function withAvatarCacheBust(url: string, bust?: number | null): string {
  if (!url || avatarUrlHasVersion(url)) return url;
  const base = url.split('?')[0];
  const v = bust ?? Date.now();
  return `${base}?v=${v}`;
}

export { AVATAR_BUST_STORAGE_KEY };
