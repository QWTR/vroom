const UUID_OR_NUMBER = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;

export function logicalScreenName(pathname: string | null | undefined): string {
  const parts = String(pathname || '/')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .filter((part) => !/^\(.+\)$/.test(part))
    .map((part) => (UUID_OR_NUMBER.test(part) ? ':id' : part.toLowerCase().replace(/[^a-z0-9]+/g, '_')));
  return parts.length ? parts.join('_').replace(/_+:id/g, '_detail') : 'home';
}
