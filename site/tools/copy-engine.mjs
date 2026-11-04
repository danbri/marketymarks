// Copies the browser build of @factoidal/core from node_modules into the built site
// (www/dpp/engine/), so pages load the exact package that `npm ci` installed and
// `npm audit signatures` checked (registry signature + Sigstore provenance), not a CDN copy.
// Also checks the wasm against the SHA-256 stamped in the package's version.json.
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../node_modules/@factoidal/core/', import.meta.url));
const version = JSON.parse(await readFile(pkg + 'package.json', 'utf8')).version;
// one folder per engine version, so a cached old engine is never mixed with a new one
const out = fileURLToPath(new URL(`../www/dpp/engine/${version}/`, import.meta.url));

// follow relative imports from browser.js
const files = new Set(), queue = ['browser.js'];
while (queue.length) {
  const f = queue.pop(); if (files.has(f)) continue; files.add(f);
  const src = await readFile(pkg + f, 'utf8');
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    queue.push(path.normalize(path.join(path.dirname(f), m[1] || m[2])));
  }
}
for (const f of ['l4-assets/l4factoidal.js', 'l4-assets/l4factoidal.mjs', 'l4-assets/l4factoidal.wasm', 'l4-assets/version.json', 'l4-assets/package.json', 'LICENSE', 'NOTICE']) files.add(f);

const stamp = JSON.parse(await readFile(pkg + 'l4-assets/version.json', 'utf8'));
const wasmHash = createHash('sha256').update(await readFile(pkg + 'l4-assets/l4factoidal.wasm')).digest('hex');
if (stamp.wasmSha256 && stamp.wasmSha256 !== wasmHash) throw new Error(`wasm hash ${wasmHash} does not match the package stamp ${stamp.wasmSha256}`);

let bytes = 0;
for (const f of files) {
  await mkdir(path.dirname(out + f), { recursive: true });
  await copyFile(pkg + f, out + f);
  bytes += (await readFile(out + f)).length;
}
await writeFile(out + 'ENGINE.json', JSON.stringify({ package: '@factoidal/core', version, wasmSha256: wasmHash, files: [...files].sort() }, null, 1) + '\n');
// point the site's loader at this version
const loader = fileURLToPath(new URL('../www/dpp/components/engine.mjs', import.meta.url));
await writeFile(loader, (await readFile(loader, 'utf8')).replace("'../engine/browser.js'", `'../engine/${version}/browser.js'`));
console.log(`engine ${version}: ${files.size} files, ${(bytes / 1e6).toFixed(1)} MB -> www/dpp/engine/${version}/ (wasm sha256 ${wasmHash.slice(0, 12)}…)`);
