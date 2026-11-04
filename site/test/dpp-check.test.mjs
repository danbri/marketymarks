// Runs the DPP checker in Node against the copied EC release:
// every EC sample passport must pass, every must-fail input must fail.
import * as F from '@factoidal/core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Checker, detectProfile } from '../content/dpp/lib/dpp-check.mjs';

const root = fileURLToPath(new URL('../content/dpp/ec/1.0.0/', import.meta.url));
const checker = new Checker(F, (p) => readFile(root + p, 'utf8'));
let failures = 0;

for (const f of await checker.samples()) {
  const name = f.split('/').pop().replace('.json', '');
  const view = (name.match(/^(pub|res1|res2|res3)-/) || [, 'all'])[1];
  const passport = JSON.parse(await checker.load(f));
  const r = await checker.check(passport, { view, profile: detectProfile(passport) });
  const ok = r.verdict === 'passes';
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} sample ${name.padEnd(20)} view=${view.padEnd(4)} ${r.verdict} problems=${r.problems.length} ${r.ms}ms`);
  if (!ok) for (const p of r.problems.slice(0, 5)) console.log(`       ${p.code} ${p.field ?? ''} ${p.explanation ?? ''}`);
}
for (const t of await checker.selfTest()) {
  if (!t.ok) failures++;
  console.log(`${t.ok ? 'ok  ' : 'FAIL'} self-test ${t.name}: expected ${t.expected}, got ${t.got} ${t.codes.join(',')}`);
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
