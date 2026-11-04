// dpp-registry-client: a client for the EU DPP Registry and Activity Dashboard APIs, for an
// economic operator's service account. Follows the EC "Service Account Technical Integration
// Guide" (private_key_jwt client credentials) and "API Integration Guide" (idempotent
// submission, Fibonacci task polling, Retry-After). WebCrypto only.
//
//   const client = createRegistryClient({ environment: 'acceptance', clientId, kid, privateKey, alg: 'ES256' });
//   const { task, items } = await client.register({ productGroup: 'BATTERIES', productSubGroup: 'EV',
//     submissionItems: [{ uniqueProductIdentifier: 'https://dpp.example.com/b/1', granularity: 'item' }] });

export const ENDPOINTS = {
  acceptance: { issuer: 'https://auth.acc.product-passport.ec.europa.eu', tokenEndpoint: 'https://auth.acc.product-passport.ec.europa.eu/oauth2/token',
    resource: 'https://auth.acc.product-passport.ec.europa.eu/resources/dpp/registry', apiBase: 'https://reg.acc.product-passport.ec.europa.eu/api/v1' },
  production: { issuer: 'https://auth.product-passport.ec.europa.eu', tokenEndpoint: 'https://auth.product-passport.ec.europa.eu/oauth2/token',
    resource: 'https://auth.product-passport.ec.europa.eu/resources/dpp/registry', apiBase: 'https://reg.product-passport.ec.europa.eu/api/v1' },
};
// the API guide's recommended polling intervals (seconds), then a 60 s cap
export const POLL_SECONDS = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
const ALGS = { ES256: ['P-256', 'SHA-256'], ES384: ['P-384', 'SHA-384'], ES512: ['P-521', 'SHA-512'] };

const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const uuid = () => globalThis.crypto.randomUUID();

export class RegistryError extends Error {
  constructor(status, body, correlationId) { super(`${status} ${body?.message || ''}`.trim()); this.status = status; this.body = body; this.correlationId = correlationId; }
}

export function createRegistryClient({
  environment = 'acceptance', issuer, tokenEndpoint, resource, apiBase, clientId, kid, privateKey, alg = 'ES256', scope,
  fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeScale = 1, maxRetries = 4,
} = {}) {
  const env = { ...ENDPOINTS[environment], ...(issuer && { issuer }), ...(tokenEndpoint && { tokenEndpoint }), ...(resource && { resource }), ...(apiBase && { apiBase }) };
  if (!ALGS[alg]) throw new Error('alg must be ES256, ES384 or ES512');
  if (!clientId || !kid || !privateKey) throw new Error('clientId, kid and privateKey are required');
  let cached = null; // { token, until }
  let tokenRequests = 0;

  // a fresh, short-lived client assertion for every token request (guide 5.2)
  async function clientAssertion() {
    const iat = Math.floor(Date.now() / 1000);
    const input = `${enc({ typ: 'client-authentication+jwt', alg, kid })}.${enc({ iss: clientId, sub: clientId, aud: env.issuer, iat, exp: iat + 90, jti: uuid() })}`;
    const sig = await globalThis.crypto.subtle.sign({ name: 'ECDSA', hash: ALGS[alg][1] }, privateKey, new TextEncoder().encode(input));
    return `${input}.${b64url(new Uint8Array(sig))}`;
  }
  // reuse the access token until shortly before it expires (guide 5.5)
  async function accessToken() {
    if (cached && Date.now() < cached.until) return cached.token;
    tokenRequests++;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: await clientAssertion(), resource: env.resource });
    if (scope) body.set('scope', scope);
    const r = await fetchImpl(env.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new RegistryError(r.status, { message: j.error_description || j.error || 'token request failed' });
    cached = { token: j.access_token, until: Date.now() + Math.max(0, (Number(j.expires_in) || 300) - 60) * 1000 };
    return cached.token;
  }
  const retryAfterMs = (r) => {
    const v = r.headers.get('retry-after'); if (!v) return null;
    const s = Number(v); if (Number.isFinite(s)) return s * 1000;
    const d = Date.parse(v); return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
  };
  // safe to retry: GETs, and POSTs that carry an Idempotency-Key
  async function call(path, { method = 'GET', body, idempotencyKey, correlationId = 'corr_' + uuid().slice(0, 12) } = {}) {
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: `Bearer ${await accessToken()}`, 'X-Correlation-Id': correlationId, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      let r;
      try { r = await fetchImpl(env.apiBase + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch (e) { if (attempt < maxRetries) { await sleep(timeScale * 1000 * 2 ** attempt * (0.5 + Math.random())); continue; } throw e; }
      if (r.status === 401 && attempt === 0) { cached = null; continue; }            // token revoked or expired early: one fresh token
      if ((r.status === 429 || r.status >= 500) && attempt < maxRetries) {
        await sleep(retryAfterMs(r) ?? timeScale * 1000 * 2 ** attempt * (0.5 + Math.random()));  // Retry-After first, else backoff with jitter
        continue;
      }
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new RegistryError(r.status, j, correlationId);
      return { status: r.status, body: j, headers: r.headers };
    }
  }
  const productGroups = async () => (await call('/dpp/product-groups')).body;
  async function submit(request, { idempotencyKey = uuid() } = {}) {
    const n = request?.submissionItems?.length || 0;
    if (n < 1 || n > 100) throw new Error('submissionItems must contain between 1 and 100 items');
    const r = await call('/dpp/submission', { method: 'POST', body: request, idempotencyKey });
    return { ...r.body, idempotencyKey };
  }
  const task = async (id) => (await call(`/tasks/${encodeURIComponent(id)}`)).body;
  async function taskItems(id, { size = 100 } = {}) {
    const out = [];
    for (let page = 0; ; page++) {
      const b = (await call(`/tasks/${encodeURIComponent(id)}/items?page=${page}&size=${size}`)).body;
      out.push(...b.content);
      if (out.length >= b.totalElements || !b.content.length) return out;
    }
  }
  // Fibonacci polling (1, 1, 2, … 55 s, then every 60 s); a Retry-After on a poll wins
  async function waitForTask(id, { onPoll = () => {}, maxWaitSeconds = 3600 } = {}) {
    let waited = 0;
    for (let i = 0; ; i++) {
      const t = await task(id);
      onPoll(t);
      if (t.status === 'COMPLETED' || t.status === 'ERROR') return t;
      const s = i < POLL_SECONDS.length ? POLL_SECONDS[i] : 60;
      if ((waited += s) > maxWaitSeconds) throw new Error(`task ${id} not finished after ${maxWaitSeconds} s`);
      await sleep(s * 1000 * timeScale);
    }
  }
  async function register(request, opts = {}) {
    const accepted = await submit(request, opts);
    const t = await waitForTask(accepted.taskId, opts);
    return { accepted, task: t, items: await taskItems(accepted.taskId) };
  }
  return { productGroups, submit, task, taskItems, waitForTask, register, accessToken, stats: () => ({ tokenRequests }) };
}
