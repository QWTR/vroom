const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/seasonApi.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const helper = new Module(filename, module);
helper._compile(compiled.outputText, filename);
const { seasonRequest, hasTimedPassOffer } = helper.exports;
const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

for (const status of [200, 404, 502]) test(`HTML response ${status} produces a readable error, never JSON Parse`, async () => {
  global.fetch = async () => new Response('<!doctype html><html>Unavailable</html>', { status });
  await assert.rejects(seasonRequest('https://example.invalid/api/seasons/archive'), /Nie udało się połączyć/);
});
test('successful archive response is returned without hiding its real data', async () => {
  const rows = [{ id: 'beta', name: 'Beta' }, { id: '2026', name: 'Sezon 2026' }];
  global.fetch = async () => Response.json(rows);
  assert.deepEqual(await seasonRequest('https://example.invalid'), rows);
});
test('expired authorization requests a new login', async () => {
  global.fetch = async () => new Response('unauthorized', { status: 401 });
  await assert.rejects(seasonRequest('https://example.invalid'), /Zaloguj się ponownie/);
});
test('claim validation keeps the shipping address code', async () => {
  global.fetch = async () => Response.json({ error: 'Uzupełnij adres', code: 'ADDRESS_REQUIRED' }, { status: 400 });
  await assert.rejects(seasonRequest('https://example.invalid'), { code: 'ADDRESS_REQUIRED', message: 'Uzupełnij adres' });
});
test('connection errors are readable and database errors are not exposed', async () => {
  global.fetch = async () => { throw new TypeError('Network request failed'); };
  await assert.rejects(seasonRequest('https://example.invalid'), /Nie udało się połączyć/);
  global.fetch = async () => Response.json({ error: 'secret SQL internals' }, { status: 500 });
  await assert.rejects(seasonRequest('https://example.invalid'), /Nie udało się połączyć/);
});
test('old and incomplete offers cannot be sold as timed passes; configured prices remain supported', () => {
  assert.equal(hasTimedPassOffer({ priceGross: 9999, currency: 'pln' }), false);
  assert.equal(hasTimedPassOffer({ priceGross: 3499, durationDays: 0, currency: 'pln' }), false);
  assert.equal(hasTimedPassOffer({ priceGross: 3499, durationDays: 30, currency: 'pln' }), true);
  assert.equal(hasTimedPassOffer({ priceGross: 4999, durationDays: 45, currency: 'pln' }), true);
});
