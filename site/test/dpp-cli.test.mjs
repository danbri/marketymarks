// The dpp command line: exit codes and key output for check, sign and verify.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/dpp.mjs', import.meta.url));
const demo = fileURLToPath(new URL('../content/dpp/demo/demo-003.json', import.meta.url));
const run = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [bin, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch (e) { return { code: e.status, out: e.stdout }; } };
const dir = mkdtempSync(path.join(tmpdir(), 'dpp-cli-'));
const results = [];
const expect = (name, ok) => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} cli ${name}`); };
try {
  expect('check: a valid passport exits 0', run('check', demo, '--view', 'pub').code === 0);
  const bad = JSON.parse(readFileSync(demo, 'utf8')); bad.colour = 'red'; writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const r = run('check', path.join(dir, 'bad.json'), '--view', 'pub');
  expect('check: an invalid passport exits 1 and names the EC code', r.code === 1 && /SEM-COM-MSG-013/.test(r.out));
  writeFileSync(path.join(dir, 'key.json'), run('keygen').out);
  writeFileSync(path.join(dir, 'signed.json'), run('sign', demo, '--key', path.join(dir, 'key.json')).out);
  expect('sign then verify exits 0', run('verify', path.join(dir, 'signed.json')).code === 0);
  writeFileSync(path.join(dir, 'signed.json'), readFileSync(path.join(dir, 'signed.json'), 'utf8').replace('"value": 250', '"value": 251'));
  expect('verify after a change exits 1', run('verify', path.join(dir, 'signed.json')).code === 1);
  expect('show prints the plain summary', /made by Rhône Batteries SAS \(fictional\) in Lyon, France/.test(run('show', demo).out));
} finally { rmSync(dir, { recursive: true, force: true }); }
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} cli failure(s)` : `cli: all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
