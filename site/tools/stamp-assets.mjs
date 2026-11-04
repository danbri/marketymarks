// After a build, add ?v=<build id> to relative .mjs/.json references in the DPP pages and
// modules, so a browser never mixes cached old modules with new ones after a deploy.
// The build id is a hash of the files' contents, so it only changes when they change.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const www = fileURLToPath(new URL('../www/dpp/', import.meta.url));
const targets = [];
for (const dir of ['components', 'components/profiles', 'lib', 'check', 'view', 'token']) {
  for (const f of await readdir(www + dir).catch(() => [])) if (/\.(mjs|html|json)$/.test(f)) targets.push(path.join(dir, f));
}
const h = createHash('sha256');
for (const f of targets.sort()) h.update(f).update(await readFile(www + f));
const id = h.digest('hex').slice(0, 10);
// relative specifiers in import/from/import()/src=/new URL('…'): ./x.mjs ../x/y.mjs, also .json
const RE = /((?:from\s*|import\(\s*|src=|new URL\(\s*)['"])(\.{1,2}\/[^'"?]+\.(?:mjs|json))(['"])/g;
let n = 0;
for (const f of targets.filter((x) => /\.(mjs|html)$/.test(x))) {
  const s = await readFile(www + f, 'utf8');
  const t = s.replace(RE, (m, a, p, b) => { n++; return `${a}${p}?v=${id}${b}`; });
  if (t !== s) await writeFile(www + f, t);
}
console.log(`stamped ${n} module references with ?v=${id}`);
