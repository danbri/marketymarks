// The compiled JSON Schemas must agree with the EC SHACL rules. A quick subset, run in CI; the
// full comparison (687 cases, also against the EC's own JSON Schemas) is a separate experiment.
import * as F from '@factoidal/core';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import { Checker, detectProfile } from '../content/dpp/lib/dpp-check.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const ec = (p) => read('../content/dpp/ec/1.0.0/' + p);
const checker = new Checker(F, ec);
const ajv = new Ajv2020({ strict: false });
const EC = 'https://repository.product-passport.ec.europa.eu/';
const unit = (v, u) => ({ ...v, unit: `${EC}core/vocabs/measurement-unit#${u}` });
const cases = (p) => [
  ['unchanged', p],
  ['unknown field', { ...p, totallyUnknownField: 'x' }],
  ['unknown battery category', { ...p, batteryCategory: p.batteryCategory?.replace(/#.*/, '#nope') }],
  ['unknown chemistry', { ...p, batteryChemistry: [String(p.batteryChemistry?.[0]).replace(/#.*/, '#nope')] }],
  ['chemistry as a single value', { ...p, batteryChemistry: p.batteryChemistry?.[0] }],
  ['wrong weight unit', { ...p, batteryWeight: unit(p.batteryWeight, 'volt') }],
  ['weight value as text', { ...p, batteryWeight: { ...p.batteryWeight, value: 'heavy' } }],
  ['postal address as a number', { ...p, manufacturerPostalAddress: 12345 }],
  ['missing manufacturing date', (({ manufacturingDate, ...r }) => r)(p)],
  ['no manufacturer name, trade name or trademark', { ...p, manufacturerIdentification: {} }],
  ['only a trade name', { ...p, manufacturerIdentification: { manufacturerTradeName: 'X' } }],
  ['bad language tag', { ...p, extinguishingAgent: { english: 'water' } }],
  ['missing content specification', (({ contentSpecificationIds, ...r }) => r)(p)],
];
let bad = 0, n = 0;
for (const sub of ['evb', 'lmt']) {
  const p = JSON.parse(await ec(`product/batteries/subgroup/${sub}/1.0.0/tests/conforms/pub-batteries-${sub}.json`));
  const profile = detectProfile(p);
  const validate = ajv.compile({ ...JSON.parse(await read(`../content/dpp/components/schemas/ec-1.0.0-pub-${sub}.schema.json`)), $id: undefined });
  for (const [name, m] of cases(p)) {
    n++;
    const shacl = (await checker.check(m, { view: 'pub', profile })).verdict === 'passes', schema = validate(m);
    if (shacl !== schema) bad++;
    console.log(`${shacl === schema ? 'ok  ' : 'FAIL'} compiler ${sub} ${name}: SHACL ${shacl ? 'passes' : 'fails'}, schema ${schema ? 'passes' : 'fails'}`);
  }
}
console.log(bad ? `${bad} compiler failure(s)` : `compiler: all ${n} cases agree with the EC SHACL rules`);
process.exit(bad ? 1 : 0);
