import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { AUTHENTICATED_ROUTES } from './authenticatedRoutes';

it('protects every account screen, including future routes, from logged-out navigation', () => {
  const names = new Set<string>(['(tabs)']);
  const walk = (directory: string, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '(tabs)') continue;
      if (entry.isDirectory()) walk(join(directory, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.tsx') && !/^[+_]/.test(entry.name)) {
        const route = `${prefix}${entry.name.slice(0, -4)}`;
        const source = readFileSync(join(directory, entry.name), 'utf8');
        if (route !== 'login' && /export\s+default|export\s*\{[^}]*\bas\s+default\b/s.test(source)) names.add(route);
      }
    }
  };
  walk(resolve(process.cwd(), 'app'));
  expect([...AUTHENTICATED_ROUTES].sort()).toEqual([...names].sort());
});
