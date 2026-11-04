// Builds content/dpp/components/ec-1.0.0-terms.json from the EC vocabularies, so
// the passport viewer has labels, definitions, units and access levels without
// loading an RDF engine in the browser.
import * as F from '@factoidal/core';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../content/dpp/ec/1.0.0/', import.meta.url));
const out = fileURLToPath(new URL('../content/dpp/components/ec-1.0.0-terms.json', import.meta.url));
const EC = 'https://repository.product-passport.ec.europa.eu/';
const manifest = JSON.parse(await readFile(root + 'manifest.json', 'utf8'));
let ds = null;
for (const f of manifest.files.filter((f) => f.includes('/vocabs/'))) {
  const d = await F.parse(await readFile(root + f, 'utf8'), { format: 'turtle', baseIRI: EC + f });
  ds = ds ? await F.datasetMerge(ds, d) : d;
}
const P = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#> PREFIX dct: <http://purl.org/dc/terms/>`;
const rows = await ds.query(`${P} SELECT ?c ?scheme ?notation ?label ?alt ?def ?note ?source ?broader ?access WHERE {
  ?c a skos:Concept . OPTIONAL { ?c skos:inScheme ?scheme } OPTIONAL { ?c skos:notation ?notation }
  OPTIONAL { ?c skos:prefLabel ?label } OPTIONAL { ?c skos:altLabel ?alt } OPTIONAL { ?c skos:definition ?def }
  OPTIONAL { ?c skos:scopeNote ?note } OPTIONAL { ?c dct:source ?source } OPTIONAL { ?c skos:broader ?broader }
  OPTIONAL { ?c dct:accessRights ?access } }`);
const ACCESS = { publicType: 'pub', batteryRestrictedType1: 'res1', batteryRestrictedType2: 'res2', batteryRestrictedType3: 'res3' };
const local = (iri) => iri.replace(/.*[#/]/, '');
const concepts = {};
for (const r of rows) {
  const c = r.get('c').value;
  const o = (concepts[c] ??= { scheme: null, notation: null, label: null, alt: null, definition: null, note: null, source: null, parent: null, access: [] });
  const v = (k) => r.get(k)?.value;
  o.scheme ??= v('scheme') ?? null; o.notation ??= v('notation') ?? null; o.label ??= v('label') ?? null;
  o.alt ??= v('alt') ?? null; o.definition ??= v('def') ?? null; o.note ??= v('note') ?? null;
  o.source ??= v('source') ?? null; o.parent ??= (v('broader') ? local(v('broader')) : null);
  const a = v('access'); if (a && ACCESS[local(a)] && !o.access.includes(ACCESS[local(a)])) o.access.push(ACCESS[local(a)]);
}
// fields: concepts of the core, common and battery vocabularies, keyed by JSON key (= notation / local name)
const FIELD_SCHEMES = ['core/vocabs/core-vocabulary', 'core/vocabs/common-vocabulary', 'product/batteries/vocabs/battery-vocabulary'].map((s) => EC + s);
const fields = {}, codes = {};
for (const [iri, c] of Object.entries(concepts)) {
  if (FIELD_SCHEMES.includes(c.scheme)) {
    const key = c.notation || local(iri);
    const applies = /EV: (\w+), LMT: (\w+), Industrial: (\w+)/.exec(c.note || '');
    fields[key] = { iri, label: c.label, definition: c.definition, legal: c.note ? c.note.replace(/\.\s*(Public|Restricted).*$/s, '') : null,
      source: c.source, parent: c.parent, access: c.access.sort(),
      applies: applies ? { evb: applies[1], lmt: applies[2], ind: applies[3] } : null };
  } else if (!/error-code$/.test(c.scheme || '')) {
    codes[iri] = { label: c.label, symbol: c.alt, definition: c.definition, scheme: c.scheme ? local(c.scheme) : null };
  }
}
await writeFile(out, JSON.stringify({ release: manifest.release, fields, codes }, null, 1) + '\n');
console.log(`terms: ${Object.keys(fields).length} fields, ${Object.keys(codes).length} codes -> ${out.split('/content/')[1]}`);
