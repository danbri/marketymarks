// End-to-end: an operator's passport server (dpp-host) and a mock EU DPP Registry, wired
// together on localhost. The registry fetches passports from the host with ES384 tokens;
// the host fetches the registry's JWKS. Statuses and shapes follow the EC OpenAPI and the
// self-hosting authentication guide.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import * as F from '@factoidal/core';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';
import { createTestIssuer } from '../content/dpp/lib/dpp-auth.mjs';
import { createHost } from '../servers/dpp-host.mjs';
import { createMockRegistry } from '../servers/dpp-mock-registry.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const checker = new Checker(F, (p) => read('../content/dpp/ec/1.0.0/' + p));
const ORG = 'ORG-NORDVIK-001', ORIGIN = 'https://www.example.org';
// validation runs the WASM engine in-process and blocks the event loop for a few seconds, so keep
// connections alive longer than that (otherwise fetch can reuse a socket the server has just closed)
const listen = (handler) => new Promise((r) => { const s = http.createServer({ keepAliveTimeout: 120_000 }, handler).listen(0, '127.0.0.1', () => r(s)); });
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

// passports the host serves, keyed by the path of their unique product identifier: the EC's
// complete (all-views) samples, each given its own identifier
const passports = new Map();
for (const [n, sub] of [['001', 'evb'], ['002', 'ind'], ['003', 'lmt']]) {
  const p = JSON.parse(await read(`../content/dpp/ec/1.0.0/product/batteries/subgroup/${sub}/1.0.0/tests/conforms/batteries-${sub}.json`));
  p.uniqueProductIdentifier = `${ORIGIN}/demo-${n}`; p.digitalProductPassportId = `${ORIGIN}/dpp/demo-${n}`;
  passports.set(`/demo-${n}`, p);
}
const bad = structuredClone(passports.get('/demo-001'));
bad.uniqueProductIdentifier = ORIGIN + '/demo-bad'; bad.digitalProductPassportId = ORIGIN + '/dpp/demo-bad'; bad.colourOfTheBattery = 'blue';
passports.set('/demo-bad', bad);
const otherOrg = structuredClone(passports.get('/demo-002'));
otherOrg.uniqueProductIdentifier = ORIGIN + '/demo-other-org';
passports.set('/demo-other-org', otherOrg);

const issuer = await createTestIssuer({ kid: 'mock-registry-1' });
let registry, host;
registry = await listen(createMockRegistry({
  issuer, checker, org: ORG,
  // UPIs are https://www.example.org/<path>; serve them from the local host, as if behind TLS
  resolve: (upi) => urlOf(host) + new URL(upi).pathname,
  fetchImpl: (u, o = {}) => fetch(u, { ...o, headers: { ...(o.headers || {}), 'X-Forwarded-Proto': 'https' } }),
}));
const hostLog = [];
host = await listen(createHost({
  origin: ORIGIN, environment: 'acceptance', trustProxy: true, passports, log: (x) => hostLog.push(x),
  fetchJwks: async () => (await fetch(urlOf(registry) + '/oauth2/jwks')).json(),
  requestorFor: (path) => ({ type: 'ORG_IDENTIFIER', value: path === '/demo-other-org' ? 'ORG-SOMEONE-ELSE' : ORG }),
}));

const api = (path, { method = 'GET', body, key, auth = 'Bearer service-account-token' } = {}) =>
  fetch(urlOf(registry) + path, { method, headers: { ...(auth ? { Authorization: auth } : {}), ...(key ? { 'Idempotency-Key': key } : {}), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
const submit = (items, key, sub = 'EV') => api('/api/v1/dpp/submission', { method: 'POST', key, body: { productGroup: 'BATTERIES', productSubGroup: sub, submissionItems: items } });
const item = (path, granularity = 'item') => ({ uniqueProductIdentifier: ORIGIN + path, granularity });
// poll as the EC guide suggests: Fibonacci back-off, capped (scaled down for a test)
async function waitFor(taskId) {
  let [a, b] = [50, 80];
  for (let i = 0; i < 40; i++) {
    const t = await (await api(`/api/v1/tasks/${taskId}`)).json();
    if (t.status === 'COMPLETED' || t.status === 'ERROR') return t;
    await new Promise((r) => setTimeout(r, a)); [a, b] = [b, Math.min(a + b, 1000)];
  }
  throw new Error('task did not finish');
}

const results = [];
const expect = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} servers ${name}${detail ? ' — ' + detail : ''}`); };

// host on its own
{
  const r = await fetch(urlOf(host) + '/demo-001', { headers: { 'X-Forwarded-Proto': 'https' } });
  const p = await r.json();
  const pubCheck = await checker.check(p, { view: 'pub' });
  expect('host: anonymous request gets 200 and the public view only', r.status === 200 && r.headers.get('vary') === 'Authorization' && !('detailedComposition' in p) && !('stateOfCertifiedEnergy' in p));
  expect('host: that public view passes the EC public rules', pubCheck.verdict === 'passes', pubCheck.problems.slice(0, 3).map((x) => x.code + ' ' + x.field).join('; '));
  const r2 = await fetch(urlOf(host) + '/demo-001', { headers: { 'X-Forwarded-Proto': 'https', Authorization: 'Bearer junk' } });
  expect('host: bad token gets 401, not the public view', r2.status === 401 && (await r2.json()).message === 'Unauthorized' && /invalid_token/.test(r2.headers.get('www-authenticate')));
  const r3 = await fetch(urlOf(host) + '/demo-001');
  expect('host: plain HTTP is refused', r3.status === 421);
  const r4 = await fetch(urlOf(host) + '/nope', { headers: { 'X-Forwarded-Proto': 'https' } });
  expect('host: unknown passport gets 404', r4.status === 404);
}
// registry API rules
{
  expect('registry: no Authorization gets 401', (await api('/api/v1/dpp/product-groups', { auth: null })).status === 401);
  expect('registry: product groups listed', (await (await api('/api/v1/dpp/product-groups')).json())[0].code === 'BATTERIES');
  expect('registry: missing Idempotency-Key gets 400', (await submit([item('/demo-001')], null)).status === 400);
  expect('registry: 101 items get 400', (await submit(Array.from({ length: 101 }, () => item('/demo-001')), 'k-101')).status === 400);
  expect('registry: http UPI gets 400', (await submit([{ uniqueProductIdentifier: 'http://www.example.org/demo-001', granularity: 'item' }], 'k-http')).status === 400);
  expect('registry: bad sub-group gets 400', (await submit([item('/demo-001')], 'k-sub', 'XX')).status === 400);
}
// a good submission
{
  const r = await submit([item('/demo-001'), item('/demo-002'), item('/demo-003')], 'k-good');
  const a = await r.json();
  expect('registry: good submission accepted with 202 and a task', r.status === 202 && a.taskType === 'DPP_REGISTRATION' && r.headers.get('location') === `/api/v1/tasks/${a.taskId}`);
  const again = await (await submit([item('/demo-001'), item('/demo-002'), item('/demo-003')], 'k-good')).json();
  expect('registry: same Idempotency-Key and body gives the same task', again.taskId === a.taskId);
  expect('registry: same key, different body gets 409', (await submit([item('/demo-001')], 'k-good')).status === 409);
  const t = await waitFor(a.taskId);
  const items = (await (await api(`/api/v1/tasks/${a.taskId}/items`)).json()).content;
  expect('registry: all compliant, so SUCCEEDED with registry identifiers', t.outcome.outcomeResult === 'SUCCEEDED' && t.specificTaskData.processingInfo.compliantItems === 3 &&
    items.every((x) => x.specificTaskItemData.uniqueRegistryIdentifier), JSON.stringify(t.specificTaskData.processingInfo));
  expect('host: the registry token was accepted (200 full) for each item', hostLog.filter((x) => x.status === 200 && x.step === 13).length >= 3);
}
// failures: semantic error, granularity mismatch, wrong requestor; registration is all or nothing
{
  const a = await (await submit([item('/demo-001'), item('/demo-bad')], 'k-bad')).json();
  const t = await waitFor(a.taskId);
  const items = (await (await api(`/api/v1/tasks/${a.taskId}/items`)).json()).content;
  const badItem = items.find((x) => x.specificTaskItemData.uniqueProductIdentifier.endsWith('/demo-bad'));
  expect('registry: one non-compliant item fails the whole submission', t.outcome.outcomeResult === 'FAILED' && t.specificTaskData.processingInfo.nonCompliantItems === 1 &&
    items.every((x) => !x.specificTaskItemData.uniqueRegistryIdentifier));
  expect('registry: the item says why (EC error code)', badItem.outcomeDetails.some((d) => d.code === 'SEMANTIC_VALIDATION_FAILED' && /SEM-COM-MSG-013/.test(d.message)), badItem.outcomeDetails.map((d) => d.message).join('; '));
  const g = await waitFor((await (await submit([item('/demo-001', 'batch')], 'k-gran')).json()).taskId);
  const gi = (await (await api(`/api/v1/tasks/${g.taskId}/items`)).json()).content[0];
  expect('registry: granularity mismatch is reported', g.outcome.outcomeResult === 'FAILED' && gi.outcomeDetails.some((d) => d.code === 'GRANULARITY_MISMATCH'));
  const o = await waitFor((await (await submit([item('/demo-other-org')], 'k-org')).json()).taskId);
  const oi = (await (await api(`/api/v1/tasks/${o.taskId}/items`)).json()).content[0];
  expect('host refuses a token for another organisation (403); registry fails the item', o.outcome.outcomeResult === 'FAILED' &&
    oi.outcomeDetails.some((d) => d.code === 'UPI_PROTECTED_FETCH_FAILED' && /403/.test(d.message)) && hostLog.some((x) => x.status === 403 && x.step === 13));
  const list = await (await api('/api/v1/tasks?size=2')).json();
  expect('dashboard: task list is paged', list.totalElements === 4 && list.content.length === 2 && !('outcome' in list.content[0]));
}
registry.close(); host.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} server failure(s)` : `servers: all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
