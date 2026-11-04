// dpp-auth: the access-token check an economic operator's own DPP server must run on
// requests from the EU DPP Registry, following the EC "DPP Registry Self-Hosting
// Authentication Guide" (2026), chapter 7.1 (required validation order, 13 steps)
// and the access-token profile in chapter 6. Uses only WebCrypto, so it runs in
// browsers, Node 20+, Deno and edge runtimes.
//
//   const check = createChecker({ environment: 'acceptance', origin: 'https://dpp.example.com',
//                                 fetchJwks: () => fetch(JWKS_URL).then(r => r.json()) });
//   const d = await check.decide({ https: true, authorization: req.headers.authorization,
//                                  expectedRequestor: { type: 'ORG_IDENTIFIER', value: 'ORG-123' } });
//   d.status: 200 | 401 | 403 | 'reject'   d.representation: 'public' | 'full' | null
//   d.steps: what was checked, in order; d.reason: why it stopped (safe to log; never contains the token)

export const ENVIRONMENTS = {
  acceptance: { issuer: 'https://auth.acc.product-passport.ec.europa.eu', jwksUri: 'https://auth.acc.product-passport.ec.europa.eu/oauth2/jwks' },
  production: { issuer: 'https://auth.product-passport.ec.europa.eu', jwksUri: 'https://auth.product-passport.ec.europa.eu/oauth2/jwks' },
};
export const SCOPE = 'dpp:registry:read';
export const STEPS = [
  [1, 'Require HTTPS', 'reject'],
  [2, 'No Authorization header: public representation only', 200],
  [3, 'Exactly one Bearer token', 401],
  [4, 'Token is a well-formed compact JWT of reasonable size', 401],
  [5, 'alg=ES384, typ=at+jwt, kid from the configured JWKS, signature valid', 401],
  [6, 'Issuer is exactly the configured environment issuer', 401],
  [7, 'sub, client_id and jti present; principal_type=SYSTEM', 401],
  [8, 'iat/exp valid within clock skew; exp after iat; lifetime at most 120 s', 401],
  [9, 'aud is exactly this server\'s HTTPS origin', 401],
  [10, `scope is exactly ${SCOPE}`, 403],
  [11, 'resource_requestor_identifiers has exactly one well-formed ORG_IDENTIFIER', 403],
  [12, 'Expected requestor resolved from local policy', 403],
  [13, 'Signed requestor type and value exactly equal the expected ones', 403],
];

const subtle = () => globalThis.crypto.subtle;
const b64urlToBytes = (s) => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const bytesToB64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (u8) => new TextDecoder('utf-8', { fatal: true }).decode(u8);
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

export function createChecker({
  environment = 'acceptance', issuer, origin, jwks, fetchJwks,
  clockSkewSeconds = 60, maxLifetimeSeconds = 120, maxTokenBytes = 8192, now = () => Date.now() / 1000,
} = {}) {
  const iss = issuer || ENVIRONMENTS[environment]?.issuer;
  if (!iss) throw new Error('unknown environment and no issuer given');
  if (!origin || !/^https:\/\/[^/?#]+$/.test(origin)) throw new Error('origin must be an https origin, e.g. https://dpp.example.com');
  let keys = jwks ? jwks.keys || [] : null;
  const imported = new Map();

  async function keyFor(kid) {
    const find = () => (keys || []).find((k) => k.kid === kid && k.kty === 'EC' && k.crv === 'P-384' && (!k.use || k.use === 'sig'));
    let jwk = find();
    let refreshed = false;
    if (!jwk && fetchJwks) { keys = (await fetchJwks()).keys || []; refreshed = true; jwk = find(); } // refresh once on unknown kid
    if (!jwk) return { key: null, refreshed };
    const id = `${kid}:${jwk.x}:${jwk.y}`;
    if (!imported.has(id)) {
      imported.set(id, await subtle().importKey('jwk', { kty: 'EC', crv: 'P-384', x: jwk.x, y: jwk.y, ext: true },
        { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']));
    }
    return { key: imported.get(id), refreshed };
  }

  async function decide({ https = true, authorization = null, expectedRequestor = null } = {}) {
    const steps = [];
    const pass = (n, detail) => steps.push({ step: n, check: STEPS[n - 1][1], ok: true, detail });
    const stop = (n, reason) => {
      steps.push({ step: n, check: STEPS[n - 1][1], ok: false, detail: reason });
      const status = STEPS[n - 1][2];
      return { status, representation: null, step: n, reason, steps,
        // RFC 6750 error codes for the WWW-Authenticate header
        wwwAuthenticate: status === 401 ? 'Bearer error="invalid_token"' : status === 403 ? 'Bearer error="insufficient_scope"' : null };
    };
    // 1
    if (!https) return stop(1, 'request did not arrive over HTTPS');
    pass(1);
    // 2
    if (authorization == null) { pass(2, 'no Authorization header'); return { status: 200, representation: 'public', step: 2, reason: null, steps }; }
    // 3
    const m = /^Bearer ([^\s,]+)$/i.exec(String(authorization)); // auth scheme is case-insensitive (RFC 9110)
    if (Array.isArray(authorization) || !m) return stop(3, 'Authorization header is not exactly one Bearer token');
    pass(3);
    const token = m[1];
    // 4
    if (token.length > maxTokenBytes) return stop(4, `token longer than ${maxTokenBytes} bytes`);
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !p.length)) return stop(4, 'not a three-part compact JWT');
    let header, claims, sig;
    try { header = JSON.parse(utf8(b64urlToBytes(parts[0]))); claims = JSON.parse(utf8(b64urlToBytes(parts[1]))); sig = b64urlToBytes(parts[2]); }
    catch { return stop(4, 'header or payload is not base64url JSON'); }
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object' || Array.isArray(claims)) return stop(4, 'header or payload is not a JSON object');
    pass(4);
    // 5 (token-supplied key locations such as jku, x5u, jwk are ignored on purpose)
    if (header.alg !== 'ES384') return stop(5, `alg is ${JSON.stringify(header.alg)}, not ES384`);
    if (header.typ !== 'at+jwt') return stop(5, `typ is ${JSON.stringify(header.typ)}, not at+jwt`);
    if (!nonEmpty(header.kid)) return stop(5, 'no kid');
    let k;
    try { k = await keyFor(header.kid); } catch { return stop(5, 'the configured JWKS could not be fetched'); }
    if (!k.key) return stop(5, `kid ${JSON.stringify(header.kid)} is not in the configured JWKS${k.refreshed ? ' (after one refresh)' : ''}`);
    if (sig.length !== 96) return stop(5, 'ES384 signature is not 96 bytes');
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-384' }, k.key, sig, signed);
    if (!ok) return stop(5, 'signature does not verify');
    pass(5, `kid ${header.kid}`);
    // 6
    if (claims.iss !== iss) return stop(6, `iss is not ${iss}`);
    pass(6);
    // 7
    if (!nonEmpty(claims.sub) || !nonEmpty(claims.client_id) || !nonEmpty(claims.jti)) return stop(7, 'sub, client_id or jti missing or empty');
    if (claims.principal_type !== 'SYSTEM') return stop(7, 'principal_type is not SYSTEM');
    pass(7, `jti ${claims.jti}`);
    // 8
    const t = now();
    if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return stop(8, 'iat or exp missing or not a number');
    if (claims.exp <= claims.iat) return stop(8, 'exp is not after iat');
    if (claims.exp - claims.iat > maxLifetimeSeconds) return stop(8, `lifetime ${claims.exp - claims.iat} s is over ${maxLifetimeSeconds} s`);
    if (claims.iat > t + clockSkewSeconds) return stop(8, 'issued in the future');
    if (claims.exp <= t - clockSkewSeconds) return stop(8, 'expired');
    pass(8);
    // 9
    if (claims.aud !== origin) return stop(9, `aud is not exactly ${origin}`);
    pass(9);
    // 10
    if (claims.scope !== SCOPE) return stop(10, `scope is not exactly ${SCOPE}`);
    pass(10);
    // 11
    const rri = claims.resource_requestor_identifiers;
    if (!Array.isArray(rri) || rri.length !== 1 || !rri[0] || typeof rri[0] !== 'object' ||
        rri[0].type !== 'ORG_IDENTIFIER' || !nonEmpty(rri[0].value)) return stop(11, 'resource_requestor_identifiers is not exactly one well-formed ORG_IDENTIFIER');
    pass(11);
    // 12
    const expected = typeof expectedRequestor === 'function' ? await expectedRequestor(claims) : expectedRequestor;
    if (!expected || !nonEmpty(expected.type) || !nonEmpty(expected.value)) return stop(12, 'no expected requestor in local policy for this DPP');
    pass(12);
    // 13 (exact comparison; no normalising, no suffix match; the expected value is not disclosed)
    if (rri[0].type !== expected.type || rri[0].value !== expected.value) return stop(13, 'requestor does not match local policy');
    pass(13);
    return { status: 200, representation: 'full', step: 13, reason: null, steps, wwwAuthenticate: null };
  }
  return { decide, issuer: iss, origin };
}

// ---- for testing and demonstrations: an ES384 key and token issuer -----------------------
export async function createTestIssuer({ kid = 'test-p384-1' } = {}) {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
  const pub = await subtle().exportKey('jwk', kp.publicKey);
  const jwks = { keys: [{ kty: 'EC', crv: 'P-384', x: pub.x, y: pub.y, kid, use: 'sig', alg: 'ES384' }] };
  async function sign(claims, header = {}) {
    const h = { typ: 'at+jwt', alg: 'ES384', kid, ...header };
    const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
    const input = `${enc(h)}.${enc(claims)}`;
    const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-384' }, kp.privateKey, new TextEncoder().encode(input)));
    return `${input}.${bytesToB64url(sig)}`;
  }
  function claims({ issuer = ENVIRONMENTS.acceptance.issuer, origin, org, now = Math.floor(Date.now() / 1000), lifetime = 120, ...extra } = {}) {
    return { iss: issuer, sub: 'dpp-registry', client_id: 'dpp-registry-test', principal_type: 'SYSTEM', aud: origin,
      scope: SCOPE, resource_requestor_identifiers: [{ type: 'ORG_IDENTIFIER', value: org }],
      iat: now, exp: now + lifetime, jti: 'at_' + Math.random().toString(36).slice(2), ...extra };
  }
  return { jwks, sign, claims, kid };
}

// Decode a token's header and claims without verifying (for display only).
export function peek(token) {
  try {
    const [h, p] = String(token).split('.');
    return { header: JSON.parse(utf8(b64urlToBytes(h))), claims: JSON.parse(utf8(b64urlToBytes(p))) };
  } catch { return null; }
}
