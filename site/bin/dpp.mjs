#!/usr/bin/env node
// dpp: command-line tools for EU Digital Product Passports (EC JSON, release 1.0.0).
//
//   dpp check <passport.json> [--view all|pub|res1|res2|res3] [--json]   exit 1 if it fails
//   dpp show <passport.json> [--audience pub|res1|res2|res3]              readable summary
//   dpp self-test                                                        EC samples pass, broken ones fail
//   dpp keygen > key.json                                                Ed25519 did:key (keep it secret)
//   dpp sign <passport.json> --key key.json > signed.json                W3C VC, eddsa-rdfc-2022
//   dpp verify <signed.json>                                             exit 1 if not verified
//   dpp token <jwt> --origin https://… --org ORG-ID [--env acceptance|production] --jwks jwks.json
//   dpp serve <dir> --origin https://… --org ORG-ID [--port 8080] [--env …] [--trust-proxy]
//   dpp mock-registry [--port 8081] [--org ORG-ID]

import { readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dppDir = path.join(here, '../content/dpp/');
const read = (p) => readFile(p, 'utf8');
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, dflt) => { const i = args.indexOf('--' + name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf('--' + name); if (i < 0) return false; args.splice(i, 1); return true; };
const die = (msg, code = 2) => { process.stderr.write(msg + '\n'); process.exit(code); };
const readJson = async (p) => { try { return JSON.parse(await read(p)); } catch (e) { die(`${p}: ${e.message}`); } };

async function engine() {
  const F = await import('@factoidal/core');
  const { Checker, detectProfile, VIEW_LABELS } = await import(path.join(dppDir, 'lib/dpp-check.mjs'));
  return { F, checker: new Checker(F, (p) => read(path.join(dppDir, 'ec/1.0.0', p))), detectProfile, VIEW_LABELS };
}

switch (cmd) {
  case 'check': {
    const view = opt('view', 'all'), json = flag('json'), file = args[0] || die('usage: dpp check <passport.json> [--view …] [--json]');
    const { checker, VIEW_LABELS } = await engine();
    const r = await checker.check(await readJson(file), { view });
    if (json) process.stdout.write(JSON.stringify(r, null, 1) + '\n');
    else {
      console.log(`${r.verdict === 'passes' ? 'PASSES' : r.verdict === 'fails' ? 'FAILS' : 'NOT CHECKED'}  ${file}  (${VIEW_LABELS[view]}, ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'})`);
      for (const p of r.problems) console.log(`  ${p.code}  ${p.field || ''}${p.value != null ? ` = ${String(p.value).slice(0, 80)}` : ''}\n      ${p.explanation || ''}`);
      for (const n of r.notes) console.log(`  note: ${n}`);
    }
    process.exit(r.verdict === 'passes' ? 0 : 1);
  }
  case 'show': {
    const audience = opt('audience', 'all'), file = args[0] || die('usage: dpp show <passport.json> [--audience …]');
    const M = await import(path.join(dppDir, 'components/dpp-model.mjs'));
    const terms = JSON.parse(await read(path.join(dppDir, 'components/ec-1.0.0-terms.json')));
    const full = await readJson(file);
    const id = M.profileIdFor(full);
    const profile = JSON.parse(await read(path.join(dppDir, `components/profiles/${id}.json`)).catch(() => '{"groups":[]}'));
    const p = M.viewFor(full, audience, terms), langs = [process.env.LANG?.split('.')[0]?.replace('_', '-') || 'en'];
    const d = M.describe(p, profile, terms, langs);
    console.log(d.title + (d.subtitle ? `\n${d.subtitle}` : '') + '\n');
    const plain = M.summarySentences(p, profile, terms, langs); if (plain.length) console.log(plain.join(' ') + '\n');
    const used = new Set();
    const lines = (obj, keys, indent) => { for (const k of keys) { if (!(k in obj)) continue; const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && M.classify(k, v, terms) === 'record') { console.log(`${indent}${M.fieldLabel(k, terms)}:`); lines(v, Object.keys(v), indent + '    '); }
      else console.log(`${indent}${M.fieldLabel(k, terms)}: ${M.textOf(k, v, terms, langs)}`); } };
    for (const g of profile.groups || []) { const keys = g.fields.filter((k) => k in p); if (!keys.length) continue; keys.forEach((k) => used.add(k)); console.log(`== ${g.title}`); lines(p, keys, '  '); console.log(); }
    const rest = Object.keys(p).filter((k) => !used.has(k)); if (rest.length) { console.log('== Other details'); lines(p, rest, '  '); }
    break;
  }
  case 'self-test': {
    const { checker } = await engine();
    const t = await checker.selfTest((i, n) => process.stderr.write(`\r${i}/${n}`));
    process.stderr.write('\n');
    for (const x of t) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.kind === 'EC sample' ? 'EC sample' : 'broken'} ${x.name}: expected ${x.expected}, got ${x.got}`);
    const bad = t.filter((x) => !x.ok).length;
    console.log(bad ? `${bad} of ${t.length} wrong: do not trust results on this setup` : `all ${t.length} correct`);
    process.exit(bad ? 1 : 0);
  }
  case 'keygen': case 'sign': case 'verify': {
    const { F, checker } = await engine();
    const { PassportCredentials } = await import(path.join(dppDir, 'lib/dpp-vc.mjs'));
    const vc = new PassportCredentials(F, checker, (p) => read(path.join(dppDir, p)));
    if (cmd === 'keygen') { process.stdout.write(JSON.stringify(await vc.newKey(), null, 1) + '\n'); process.stderr.write('Keep this file secret: it contains the private key.\n'); break; }
    if (cmd === 'sign') {
      const key = await readJson(opt('key') || die('usage: dpp sign <passport.json> --key key.json'));
      process.stdout.write(JSON.stringify(await vc.sign(await readJson(args[0] || die('missing passport file')), key), null, 1) + '\n');
      break;
    }
    const r = await vc.verify(await readJson(args[0] || die('usage: dpp verify <signed.json>')));
    console.log(r.verified ? `VERIFIED  issuer ${r.issuer}` : `NOT VERIFIED  ${r.reason}${r.issuer ? `  (issuer ${r.issuer})` : ''}`);
    process.exit(r.verified ? 0 : 1);
  }
  case 'token': {
    const { createChecker } = await import(path.join(dppDir, 'lib/dpp-auth.mjs'));
    const origin = opt('origin') || die('--origin is required'), org = opt('org'), env = opt('env', 'acceptance'), jwksFile = opt('jwks') || die('--jwks is required');
    const c = createChecker({ environment: env, origin, jwks: await readJson(jwksFile) });
    const d = await c.decide({ https: true, authorization: args[0] ? `Bearer ${args[0]}` : null, expectedRequestor: org ? { type: 'ORG_IDENTIFIER', value: org } : null });
    for (const s of d.steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} step ${String(s.step).padStart(2)}  ${s.check}${s.ok ? '' : `: ${s.detail}`}`);
    console.log(`=> ${d.status}${d.representation ? ' ' + d.representation : ''}`);
    process.exit(d.status === 200 ? 0 : 1);
  }
  case 'serve': {
    const { createHost } = await import(path.join(here, '../servers/dpp-host.mjs'));
    const dir = args[0] || die('usage: dpp serve <dir> --origin https://… --org ORG-ID');
    const origin = opt('origin') || die('--origin is required'), org = opt('org') || die('--org is required');
    const port = Number(opt('port', 8080)), env = opt('env', 'acceptance'), trustProxy = flag('trust-proxy');
    const passports = new Map();
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json'))) {
      const p = await readJson(path.join(dir, f));
      if (p.uniqueProductIdentifier?.startsWith(origin + '/')) passports.set(new URL(p.uniqueProductIdentifier).pathname, p);
    }
    const { ENVIRONMENTS } = await import(path.join(dppDir, 'lib/dpp-auth.mjs'));
    const jwksUri = opt('jwks-uri', ENVIRONMENTS[env].jwksUri);
    http.createServer(createHost({ origin, environment: env, passports, trustProxy, requestorFor: () => ({ type: 'ORG_IDENTIFIER', value: org }),
      fetchJwks: () => fetch(jwksUri).then((r) => r.json()), log: (x) => console.log(JSON.stringify(x)) })).listen(port, () =>
      console.log(`serving ${passports.size} passport(s) for ${origin} on port ${port}${trustProxy ? ' (trusting X-Forwarded-Proto)' : ''}`));
    break;
  }
  case 'mock-registry': {
    const { createMockRegistry } = await import(path.join(here, '../servers/dpp-mock-registry.mjs'));
    const { createTestIssuer } = await import(path.join(dppDir, 'lib/dpp-auth.mjs'));
    const { checker } = await engine();
    const port = Number(opt('port', 8081)), org = opt('org', 'ORG-TEST-0001');
    http.createServer({ keepAliveTimeout: 120_000 }, createMockRegistry({ issuer: await createTestIssuer({ kid: 'mock-registry-1' }), checker, org }))
      .listen(port, () => console.log(`mock registry on port ${port}: POST /api/v1/dpp/submission, GET /api/v1/tasks, JWKS at /oauth2/jwks (any Bearer value accepted)`));
    break;
  }
  default:
    console.log((await read(fileURLToPath(import.meta.url))).split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
}
