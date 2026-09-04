import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('daily duel refresh contract', () => {
  it('refreshes the persisted card immediately on focus and app resume', () => {
    const source = fs.readFileSync(path.join(root, 'hooks', 'useDailyDuel.ts'), 'utf8');

    expect(source).toContain("refetchOnMount: 'always'");
    expect(source).toContain("refetchOnWindowFocus: 'always'");
    expect(source).toMatch(/if \(!enabled\) return;[\s\S]*refetchQueries\([\s\S]*dailyDuelKeys\.card/);
  });

  it('drops the old persisted card before opening a duel notification', () => {
    const source = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');

    expect(source).toMatch(/daily_duel_available[\s\S]*removeQueries\([\s\S]*daily-duel[\s\S]*card/);
  });
});
