// Builds, for every battery subgroup and view, from the EC SHACL shapes (release 1.0.0):
//   components/shapes/ec-1.0.0-<view>-<sub>.json    the shape tree (for displays and forms)
//   components/schemas/ec-1.0.0-<view>-<sub>.schema.json   a JSON Schema compiled from it
// The compiled schemas are checked against the EC SHACL rules by experiments/compiler.
import * as F from '@factoidal/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';
import { extractShapes } from '../content/dpp/lib/dpp-shapes.mjs';
import { compile } from '../content/dpp/lib/shapes-to-jsonschema.mjs';

const dpp = fileURLToPath(new URL('../content/dpp/', import.meta.url));
const ec = (p) => readFile(dpp + 'ec/1.0.0/' + p, 'utf8');
const terms = JSON.parse(await readFile(dpp + 'components/ec-1.0.0-terms.json', 'utf8'));
const keyOfIri = new Map(Object.entries(terms.fields).map(([k, v]) => [v.iri, k]));
const checker = new Checker(F, ec);
await mkdir(dpp + 'components/shapes', { recursive: true });
await mkdir(dpp + 'components/schemas', { recursive: true });
const index = [];
for (const sub of ['evb', 'ind', 'lmt']) {
  const context = await checker.contextFor({ product: 'batteries', sub });
  for (const view of ['all', 'pub', 'res1', 'res2', 'res3']) {
    const tree = await extractShapes(F, ec, { view, sub, product: 'batteries', keyOf: (i) => keyOfIri.get(i) || i.replace(/.*[#/]/, '') });
    const name = `ec-1.0.0-${view}-${sub}`;
    await writeFile(`${dpp}components/shapes/${name}.json`, JSON.stringify(tree) + '\n');
    const schema = compile(tree, terms, { context, id: `https://marketymarks.com/dpp/components/schemas/${name}.schema.json` });
    await writeFile(`${dpp}components/schemas/${name}.schema.json`, JSON.stringify(schema, null, 1) + '\n');
    index.push({ view, sub, shapes: `shapes/${name}.json`, schema: `schemas/${name}.schema.json`, fields: Object.keys(tree.root.props).length, gaps: schema['x-dpp-gaps'] });
  }
}
await writeFile(dpp + 'components/shapes/index.json', JSON.stringify(index, null, 1) + '\n');
console.log(`shapes and schemas: ${index.length} (${index.filter((x) => x.gaps.length).length} with gaps)`);
