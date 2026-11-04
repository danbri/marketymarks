// The EC self-hosting guide's minimum conformance test matrix (section 12.1), plus
// attacks the guide warns about. Expected statuses come from the guide.
import { createChecker, createTestIssuer, ENVIRONMENTS } from '../content/dpp/lib/dpp-auth.mjs';

const ORIGIN = 'https://dpp.example.com', ORG = 'ORG-ACME-123';
const issuer = await createTestIssuer({ kid: 'k1' });
const prodIssuer = await createTestIssuer({ kid: 'k1' });           // same kid, different key
let jwksFetches = 0;
const mk = (opts = {}) => createChecker({ environment: 'acceptance', origin: ORIGIN, jwks: issuer.jwks,
  fetchJwks: async () => { jwksFetches++; return issuer.jwks; }, ...opts });
const check = mk();
const tok = (over = {}, header = {}, who = issuer) => who.sign({ ...issuer.claims({ origin: ORIGIN, org: ORG }), ...over }, header);
const req = async (t, expected = { type: 'ORG_IDENTIFIER', value: ORG }, c = check, extra = {}) =>
  c.decide({ https: true, authorization: t === null ? null : `Bearer ${t}`, expectedRequestor: expected, ...extra });
const tamper = (t) => { const [h, p, s] = t.split('.'); return `${h}.${p}.${s.slice(0, -4)}${s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const cases = [
  // guide section 12.1
  ['header absent: public only', () => req(null), 200, 'public'],
  ['valid token, everything matches: public + protected', async () => req(await tok()), 200, 'full'],
  ['header present but token invalid: no fallback', () => req('not-a-jwt'), 401],
  ['wrong requestor identifier', async () => req(await tok(), { type: 'ORG_IDENTIFIER', value: 'ORG-CONTOSO-456' }), 403],
  ['wrong audience', async () => req(await tok({ aud: 'https://other.example.com' })), 401],
  ['scope not exactly dpp:registry:read', async () => req(await tok({ scope: 'dpp:registry:read dpp:registry:write' })), 403],
  ['expired token', async () => req(await tok({ iat: now - 600, exp: now - 480 })), 401],
  ['lifetime over 120 s', async () => req(await tok({ iat: now, exp: now + 121 })), 401],
  ['principal_type absent', async () => req(await tok({ principal_type: undefined })), 401],
  ['principal_type not SYSTEM', async () => req(await tok({ principal_type: 'USER' })), 401],
  ['unknown kid after one JWKS refresh', async () => { const before = jwksFetches; const r = await req(await tok({}, { kid: 'k9' })); r._refreshes = jwksFetches - before; return r; }, 401],
  ['invalid ES384 signature', async () => req(tamper(await tok())), 401],
  ['malformed resource_requestor_identifiers', async () => req(await tok({ resource_requestor_identifiers: [{ type: 'ORG_IDENTIFIER' }] })), 403],
  ['production token at an acceptance endpoint', async () => req(await tok({ iss: ENVIRONMENTS.production.issuer })), 401],
  // further cases from the guide's text
  ['not HTTPS', async () => check.decide({ https: false, authorization: `Bearer ${await tok()}`, expectedRequestor: { type: 'ORG_IDENTIFIER', value: ORG } }), 'reject'],
  ['two identifiers in resource_requestor_identifiers', async () => req(await tok({ resource_requestor_identifiers: [{ type: 'ORG_IDENTIFIER', value: ORG }, { type: 'ORG_IDENTIFIER', value: 'X' }] })), 403],
  ['unsupported identifier type (UOI)', async () => req(await tok({ resource_requestor_identifiers: [{ type: 'UOI', value: ORG }] })), 403],
  ['requestor value differs only by case', async () => req(await tok({ resource_requestor_identifiers: [{ type: 'ORG_IDENTIFIER', value: ORG.toLowerCase() }] })), 403],
  ['no expected requestor in local policy', async () => req(await tok(), null), 403],
  ['typ JWT instead of at+jwt', async () => req(await tok({}, { typ: 'JWT' })), 401],
  ['alg none, unsigned', async () => req(`${b64({ alg: 'none', typ: 'at+jwt', kid: 'k1' })}.${b64(issuer.claims({ origin: ORIGIN, org: ORG }))}.`), 401],
  ['alg HS384 header on an ES384 signature', async () => { const t = await tok(); const [, p, s] = t.split('.'); return req(`${b64({ alg: 'HS384', typ: 'at+jwt', kid: 'k1' })}.${p}.${s}`); }, 401],
  ['token signs with attacker key and points jku at it', async () => req(await tok({}, { jku: 'https://evil.example/jwks' }, prodIssuer)), 401],
  ['empty jti', async () => req(await tok({ jti: '' })), 401],
  ['iat in the future beyond skew', async () => req(await tok({ iat: now + 300, exp: now + 400 })), 401],
  ['exp before iat', async () => req(await tok({ iat: now, exp: now - 1 })), 401],
  ['oversized token', () => req('a'.repeat(9000) + '.b.c'), 401],
  ['two Bearer tokens in one header', async () => check.decide({ https: true, authorization: `Bearer ${await tok()}, Bearer ${await tok()}`, expectedRequestor: { type: 'ORG_IDENTIFIER', value: ORG } }), 401],
  ['lower-case bearer scheme', async () => check.decide({ https: true, authorization: `bearer ${await tok()}`, expectedRequestor: { type: 'ORG_IDENTIFIER', value: ORG } }), 200, 'full'],
  ['JWKS unreachable for an unknown kid: fail closed', async () => req(await tok({}, { kid: 'k2' }), undefined, mk({ jwks: issuer.jwks, fetchJwks: async () => { throw new Error('down'); } })), 401],
  ['cached key still works while JWKS is down', async () => req(await tok(), undefined, mk({ fetchJwks: async () => { throw new Error('down'); } })), 200, 'full'],
  ['key rotation: new kid found after refresh', async () => {
    const next = await createTestIssuer({ kid: 'k2' });
    const c = mk({ jwks: issuer.jwks, fetchJwks: async () => ({ keys: [...issuer.jwks.keys, ...next.jwks.keys] }) });
    return req(await next.sign(issuer.claims({ origin: ORIGIN, org: ORG })), undefined, c);
  }, 200, 'full'],
];

let bad = 0;
for (const [name, fn, status, rep] of cases) {
  const r = await fn();
  const ok = r.status === status && (rep === undefined || r.representation === rep) && (name.startsWith('unknown kid') ? r._refreshes === 1 : true);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} token ${name.padEnd(52)} -> ${r.status}${r.representation ? ' ' + r.representation : ''}${r.reason ? ` (step ${r.step}: ${r.reason})` : ''}`);
}
console.log(bad ? `${bad} token failure(s)` : `token: all ${cases.length} cases passed`);
process.exit(bad ? 1 : 0);
