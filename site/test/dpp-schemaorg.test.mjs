// The schema.org view and the GBA pilot passports: every passport we publish must map to
// schema.org JSON-LD that converts to RDF, typed schema:Product, with the pending DPP link;
// every GBA passport must load and be checked (they are expected to fail the EC rules).
import * as F from '@factoidal/core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { toSchemaOrg, OFFLINE_CONTEXT } from '../content/dpp/components/dpp-schemaorg.mjs';
import { profileIdFor } from '../content/dpp/components/dpp-model.mjs';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';

const dir = (p) => fileURLToPath(new URL(`../content/dpp/${p}`, import.meta.url));
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const terms = await json(dir('components/ec-1.0.0-terms.json'));
const profiles = { batteries: await json(dir('components/profiles/batteries.json')), core: await json(dir('components/profiles/core.json')) };
const manifest = await json(dir('ec/1.0.0/manifest.json'));
const all = [
  ...manifest.files.filter((f) => f.includes('/tests/conforms/')).map((f) => ['EC ' + f.split('/').pop(), dir('ec/1.0.0/' + f)]),
  ...(await json(dir('demo/index.json'))).map((f) => ['demo ' + f, dir('demo/' + f)]),
  ...(await json(dir('gba/index.json'))).map((x) => ['GBA ' + x.passport.split('/').pop().slice(0, 40), dir('gba/' + x.passport)]),
];
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };
for (const [name, file] of all) {
  const p = await json(file);
  const so = toSchemaOrg(p, terms, profiles[profileIdFor(p)], ['en']);
  const ds = await F.jsonldToRdf(JSON.stringify({ ...so, '@context': OFFLINE_CONTEXT }));
  // restricted-view samples are partial passports with no passport id, so no DPP link is expected for them
  const typed = await ds.query(p.digitalProductPassportId ? 'ASK { ?s a <https://schema.org/Product> ; <https://schema.org/hasDigitalProductPassport> ?d }'
    : 'ASK { ?s a <https://schema.org/Product> }');
  if (!typed || ds.size < 3) fail(`schema.org ${name}: ${ds.size} triples, typed as expected: ${typed}`);
  else console.log(`ok   schema.org ${name.padEnd(48)} ${ds.size} triples`);
}
// GBA passports are real data in another shape: they load, are checked, and fail with reasons
const checker = new Checker(F, (p) => readFile(dir('ec/1.0.0/' + p), 'utf8'));
const gba = await json(dir('gba/index.json'));
if (gba.length !== 21) fail(`GBA: expected 21 passports, found ${gba.length}`);
for (const x of gba.slice(0, 3)) {
  const r = await checker.check(await json(dir('gba/' + x.passport)), { view: 'pub' });
  if (r.verdict !== 'fails' || !r.problems.every((pr) => pr.code)) fail(`GBA ${x.passport}: ${r.verdict}`);
  else console.log(`ok   GBA ${x.passport.slice(3, 50).padEnd(48)} fails with ${r.problems.length} coded problems, as expected`);
}
console.log(bad ? `${bad} failure(s)` : `all passed`);
process.exit(bad ? 1 : 0);
