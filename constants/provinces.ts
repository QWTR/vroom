/** 16 województw PL — slug/mention bez polskich znaków (np. @slask). */
export type PolishProvince = {
  slug: string;
  mention: string;
  label: string;
};

export const POLISH_PROVINCES: PolishProvince[] = [
  { slug: 'dolnoslaskie', mention: 'dolnoslaskie', label: 'Dolnośląskie' },
  { slug: 'kujawsko-pomorskie', mention: 'kujawsko-pomorskie', label: 'Kujawsko-pomorskie' },
  { slug: 'lubelskie', mention: 'lubelskie', label: 'Lubelskie' },
  { slug: 'lubuskie', mention: 'lubuskie', label: 'Lubuskie' },
  { slug: 'lodzkie', mention: 'lodzkie', label: 'Łódzkie' },
  { slug: 'malopolskie', mention: 'malopolskie', label: 'Małopolskie' },
  { slug: 'mazowieckie', mention: 'mazowieckie', label: 'Mazowieckie' },
  { slug: 'opolskie', mention: 'opolskie', label: 'Opolskie' },
  { slug: 'podkarpackie', mention: 'podkarpackie', label: 'Podkarpackie' },
  { slug: 'podlaskie', mention: 'podlaskie', label: 'Podlaskie' },
  { slug: 'pomorskie', mention: 'pomorskie', label: 'Pomorskie' },
  { slug: 'slask', mention: 'slask', label: 'Śląskie' },
  { slug: 'swietokrzyskie', mention: 'swietokrzyskie', label: 'Świętokrzyskie' },
  { slug: 'warminsko-mazurskie', mention: 'warminsko-mazurskie', label: 'Warmińsko-mazurskie' },
  { slug: 'wielkopolskie', mention: 'wielkopolskie', label: 'Wielkopolskie' },
  { slug: 'zachodniopomorskie', mention: 'zachodniopomorskie', label: 'Zachodniopomorskie' },
];

const byMention = new Map(
  POLISH_PROVINCES.flatMap(p => [
    [p.mention.toLowerCase(), p] as const,
    [p.slug.toLowerCase(), p] as const,
  ]),
);

const bySlug = new Map(POLISH_PROVINCES.map(p => [p.slug, p]));

export function getProvinceByMention(token: string): PolishProvince | null {
  if (!token) return null;
  return byMention.get(token.toLowerCase()) ?? null;
}

export function getProvinceBySlug(slug: string | null | undefined): PolishProvince | null {
  if (!slug) return null;
  return bySlug.get(slug) ?? null;
}

export function getProvinceLabel(slug: string | null | undefined): string | null {
  return getProvinceBySlug(slug)?.label ?? null;
}

export function isValidProvinceSlug(slug: string | null | undefined): boolean {
  if (!slug) return true;
  return bySlug.has(slug);
}

export function filterProvinceSuggestions(query: string, limit = 5): PolishProvince[] {
  const q = query.trim().toLowerCase();
  if (!q) return POLISH_PROVINCES.slice(0, limit);
  return POLISH_PROVINCES.filter(
    p => p.mention.includes(q) || p.label.toLowerCase().includes(q),
  ).slice(0, limit);
}
