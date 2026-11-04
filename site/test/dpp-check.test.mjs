// Runs the checker's self-test in Node against the copied EC release:
// every EC sample passport must pass, every deliberately broken one must fail.
import * as F from '@factoidal/core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';

const root = fileURLToPath(new URL('../content/dpp/ec/1.0.0/', import.meta.url));
const checker = new Checker(F, (p) => readFile(root + p, 'utf8'));
const results = await checker.selfTest();
for (const t of results) {
  console.log(`${t.ok ? 'ok  ' : 'FAIL'} ${t.kind.padEnd(9)} ${t.name.padEnd(36)} view=${t.view.padEnd(4)} expected ${t.expected}, got ${t.got} ${t.codes.join(',')} ${t.ms}ms`);
}
// the fictional demo passports must pass too
const demoDir = fileURLToPath(new URL('../content/dpp/demo/', import.meta.url));
for (const f of JSON.parse(await readFile(demoDir + 'index.json', 'utf8'))) {
  const r = await checker.check(JSON.parse(await readFile(demoDir + f, 'utf8')), { view: 'pub' });
  const ok = r.verdict === 'passes';
  results.push({ ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} demo      ${f.padEnd(36)} view=pub  expected passes, got ${r.verdict}`);
}
const failures = results.filter((t) => !t.ok).length;
console.log(failures ? `${failures} failure(s)` : `all ${results.length} passed`);
process.exit(failures ? 1 : 0);
