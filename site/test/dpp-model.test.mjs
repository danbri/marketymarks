// Unit tests for the formatting model used by the web components (no browser needed).
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as M from '../content/dpp/components/dpp-model.mjs';

const terms = JSON.parse(await readFile(new URL('../content/dpp/components/ec-1.0.0-terms.json', import.meta.url), 'utf8'));
const EC = M.EC, langs = ['en-GB'];
const unit = (u) => `${EC}core/vocabs/measurement-unit#${u}`;
const checks = [
  ['quantity with symbol', M.textOf('batteryWeight', { unit: unit('kilogram'), value: 385.5 }, terms, langs), '385.5 kg'],
  ['percent has no space', M.textOf('renewableContentShare', { unit: unit('percent'), value: 12.5 }, terms, langs), '12.5%'],
  ['code label', M.textOf('batteryCategory', `${EC}product/batteries/vocabs/battery-category#industrialBattery`, terms, langs).startsWith('IND'), true],
  ['country name', M.textOf('manufacturingCountry', 'ESP', terms, langs), 'Spain'],
  ['POSIX locale falls back to English', M.textOf('manufacturingCountry', 'FRA', terms, ['C.UTF-8']) + ' ' + M.textOf('manufacturingDate', '2026-10', terms, ['C']), 'France October 2026'],
  ['year-month date', M.textOf('manufacturingDate', '2026-03', terms, langs), 'March 2026'],
  ['language pick: same language', M.pickLang({ 'de-DE': 'Wasser', 'en-IE': 'water' }, ['en-GB']).text, 'water'],
  ['language pick: fallback English', M.pickLang({ 'de-DE': 'Wasser', 'en-IE': 'water' }, ['ja']).text, 'water'],
  ['lang map detection', M.isLangMap({ 'en-IE': 'x' }) && !M.isLangMap({ unit: 'x', value: 1 }), true],
  ['camelCase label split', M.fieldLabel('dppStatus', terms), 'DPP status'],
  ['public field visible to public', M.visibleTo('batteryCapacity', 'pub', terms), true],
  ['restricted field hidden from public', M.visibleTo('detailedComposition', 'pub', terms), false],
  ['unknown field hidden from public', M.visibleTo('totallyUnknownField', 'pub', terms), false],
  ['Object.prototype names are unknown fields', ['constructor', '__proto__', 'toString', 'hasOwnProperty'].some((k) => M.visibleTo(k, 'pub', terms)), false],
  ['short IRI', M.shortIri(`${EC}product/batteries/vocabs/battery-vocabulary#batteryWeight`), 'bat:batteryWeight'],
  ['plain summary', M.summarySentences(JSON.parse(await readFile(new URL('../content/dpp/demo/demo-004.json', import.meta.url), 'utf8')),
    JSON.parse(await readFile(new URL('../content/dpp/components/profiles/batteries.json', import.meta.url), 'utf8')), terms, langs)[0],
    'A light means of transport battery made by Velocità Moto S.r.l. (fictional) in Turin, Italy, in May 2026.'],
  ['required-but-missing from the shape tree', (() => {
    const tree = { root: { props: { a: { min: 1 }, b: { min: 0 }, c: { min: 1, node: { props: { d: { min: 1 } } } }, e: { min: 0, qualified: [{ min: 1 }] } }, anyOf: [[{ props: { x: { min: 1 } } }, { props: { y: { min: 1 } } }], [{ props: { z: { min: 0 } } }, { props: { z: { min: 1 } } }]] } };
    return M.missingRequired({ b: 1, c: {} }, tree).join(',');
  })(), 'a,c.d,e,x | y'],
];
let bad = 0;
for (const [name, got, want] of checks) {
  try { assert.deepEqual(got, want); console.log(`ok   model ${name}`); } catch { bad++; console.log(`FAIL model ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
// every EC sample and demo that passes must show nothing missing for its own view
{
  const root2 = new URL('../content/dpp/', import.meta.url);
  const man = JSON.parse(await readFile(new URL('ec/1.0.0/manifest.json', root2), 'utf8'));
  const tree = async (v, s) => JSON.parse(await readFile(new URL(`components/shapes/ec-1.0.0-${v}-${s}.json`, root2), 'utf8'));
  const list = man.files.filter((f) => /subgroup\/(evb|ind|lmt)\/.*\/tests\/conforms\//.test(f)).map((f) => [new URL('ec/1.0.0/' + f, root2), (f.match(/\/(pub|res1|res2|res3)-/) || [, 'all'])[1], f.match(/subgroup\/(\w+)\//)[1]]);
  for (const f of JSON.parse(await readFile(new URL('demo/index.json', root2), 'utf8'))) { const p = JSON.parse(await readFile(new URL('demo/' + f, root2), 'utf8')); list.push([new URL('demo/' + f, root2), 'pub', M.subgroupOf(p)]); }
  for (const [u, v, s] of list) {
    const miss = M.missingRequired(JSON.parse(await readFile(u, 'utf8')), await tree(v, s));
    if (miss.length) { bad++; console.log(`FAIL missing ${u.pathname.split('/').pop()} (${v}): ${miss.join(', ')}`); }
  }
}
// no-leak: the public view of every EC sample contains only public fields, at every level
const root = new URL('../content/dpp/ec/1.0.0/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
for (const f of manifest.files.filter((x) => x.includes('/tests/conforms/'))) {
  const p = JSON.parse(await readFile(new URL(f, root), 'utf8'));
  for (const aud of ['pub', 'res1', 'res2', 'res3']) {
    const v = M.viewFor(p, aud, terms);
    const leak = [];
    const walk = (o) => { for (const [k, x] of Object.entries(o)) { if (!M.visibleTo(k, aud, terms)) leak.push(k); if (x && typeof x === 'object' && !Array.isArray(x) && M.classify(k, x, terms) === 'record') walk(x); } };
    walk(v);
    if (leak.length) { bad++; console.log(`FAIL no-leak ${f} as ${aud}: ${leak.join(', ')}`); }
  }
}
// nothing lost: an EC sample made for one view must come through that view's filter unchanged
for (const f of manifest.files.filter((x) => /\/tests\/conforms\/(pub|res1|res2|res3)-/.test(x))) {
  const p = JSON.parse(await readFile(new URL(f, root), 'utf8'));
  const aud = f.match(/\/(pub|res1|res2|res3)-/)[1];
  const v = M.viewFor(p, aud, terms);
  if (JSON.stringify(v) !== JSON.stringify(p)) { bad++; console.log(`FAIL nothing-lost ${f} as ${aud}`); }
}
console.log(bad ? `${bad} model failure(s)` : `model: all ${checks.length} checks, the no-leak and the nothing-lost checks passed`);
process.exit(bad ? 1 : 0);
