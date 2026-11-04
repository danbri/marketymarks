// The registry client against the mock registry and the reference host: service-account
// token flow (private_key_jwt), submission, Fibonacci polling, idempotency, Retry-After.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import * as F from '@factoidal/core';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';
import { createTestIssuer } from '../content/dpp/lib/dpp-auth.mjs';
import { createRegistryClient, RegistryError } from '../content/dpp/lib/dpp-registry-client.mjs';
import { createHost } from '../servers/dpp-host.mjs';
import { createMockRegistry } from '../servers/dpp-mock-registry.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const checker = new Checker(F, (p) => read('../content/dpp/ec/1.0.0/' + p));
const ORG = 'ORG-NORDVIK-001', ORIGIN = 'https://www.example.org', ACC = 'https://auth.acc.product-passport.ec.europa.eu';
const listen = (h) => new Promise((r) => { const s = http.createServer({ keepAliveTimeout: 120_000 }, h).listen(0, '127.0.0.1', () => r(s)); });
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

const p = JSON.parse(await read('../content/dpp/ec/1.0.0/product/batteries/subgroup/evb/1.0.0/tests/conforms/batteries-evb.json'));
p.uniqueProductIdentifier = ORIGIN + '/c-001'; p.digitalProductPassportId = ORIGIN + '/dpp/c-001';
const passports = new Map([['/c-001', p]]);

// the operator's service account key (ES256), registered with the (mock) registry
const sa = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const saPub = await crypto.subtle.exportKey('jwk', sa.publicKey);
const intruder = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const issuer = await createTestIssuer({ kid: 'mock-registry-1' });
let host;
const registry = await listen(createMockRegistry({ issuer, checker, org: ORG, clients: { 'client-eo-1': { kid: 'sa-key-1', jwk: saPub } },
  resolve: (u) => urlOf(host) + new URL(u).pathname,
  fetchImpl: (u, o = {}) => fetch(u, { ...o, headers: { ...(o.headers || {}), 'X-Forwarded-Proto': 'https' } }) }));
host = await listen(createHost({ origin: ORIGIN, trustProxy: true, passports,
  fetchJwks: async () => (await fetch(urlOf(registry) + '/oauth2/jwks')).json(),
  requestorFor: () => ({ type: 'ORG_IDENTIFIER', value: ORG }) }));

let first429 = true;
const fetchImpl = async (u, o) => {
  if (first429 && String(u).endsWith('/dpp/product-groups')) { first429 = false; return new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'Retry-After': '0' } }); }
  return fetch(u, o);
};
const conf = { issuer: ACC, tokenEndpoint: urlOf(registry) + '/oauth2/token', resource: ACC + '/resources/dpp/registry', apiBase: urlOf(registry) + '/api/v1',
  clientId: 'client-eo-1', kid: 'sa-key-1', alg: 'ES256', timeScale: 0.01 };
const client = createRegistryClient({ ...conf, privateKey: sa.privateKey, fetchImpl });

const results = [];
const expect = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} client ${name}${detail ? ' — ' + detail : ''}`); };

const groups = await client.productGroups();
expect('product groups, after one 429 with Retry-After', groups[0].code === 'BATTERIES' && !first429);
const polls = [];
const { accepted, task, items } = await client.register({ productGroup: 'BATTERIES', productSubGroup: 'EV',
  submissionItems: [{ uniqueProductIdentifier: ORIGIN + '/c-001', granularity: 'item' }] }, { onPoll: (t) => polls.push(t.status) });
expect('register: submission accepted, task completed, SUCCEEDED', accepted.taskId && task.status === 'COMPLETED' && task.outcome.outcomeResult === 'SUCCEEDED', `polls: ${polls.join(',')}`);
expect('register: the item has a registry identifier', !!items[0].specificTaskItemData.uniqueRegistryIdentifier);
expect('one access token reused for every call', client.stats().tokenRequests === 1, `token requests: ${client.stats().tokenRequests}`);
const again = await client.submit({ productGroup: 'BATTERIES', productSubGroup: 'EV',
  submissionItems: [{ uniqueProductIdentifier: ORIGIN + '/c-001', granularity: 'item' }] }, { idempotencyKey: accepted.idempotencyKey });
expect('retry with the same Idempotency-Key returns the same task', again.taskId === accepted.taskId);
try {
  await createRegistryClient({ ...conf, privateKey: intruder.privateKey }).productGroups();
  expect('a client signing with the wrong key is refused', false);
} catch (e) { expect('a client signing with the wrong key is refused', e instanceof RegistryError && e.status === 401, e.message); }
const forged = await issuer.sign({ iss: ACC, aud: 'https://elsewhere', exp: Math.floor(Date.now() / 1000) + 60, client_id: 'client-eo-1' });
const r = await fetch(urlOf(registry) + '/api/v1/dpp/product-groups', { headers: { Authorization: 'Bearer ' + forged } });
expect('the API refuses a token for another audience', r.status === 401);

registry.close(); host.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} client failure(s)` : `client: all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
