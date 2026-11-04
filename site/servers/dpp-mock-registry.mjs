// dpp-mock-registry: a stand-in for the EU DPP Registry and Activity Dashboard, for testing
// an operator's systems without EU Login or the EC Acceptance environment. It follows the
// EC public OpenAPI (registry, dashboard, common; 1.0) and the self-hosting auth guide:
//   GET  /api/v1/dpp/product-groups
//   POST /api/v1/dpp/submission          (Idempotency-Key required; 1-100 items; 202 + taskId)
//   GET  /api/v1/tasks, /api/v1/tasks/{id}, /api/v1/tasks/{id}/items
//   GET  /oauth2/jwks                     (its own test signing key, like the DPP Authentication Service)
//   POST /oauth2/token                    (client credentials with private_key_jwt, when `clients` are given)
// For each submitted item it fetches the passport at its unique product identifier, once
// anonymously and once with an ES384 access token, and checks both with the EC rules
// (public view and full passport). Registration is atomic: one non-compliant item fails all.
//
// Not the real Registry: no EU Login, no organisation verification, no proof of registration.
// Validation runs the WASM engine in this process and blocks it for a few seconds per
// passport; for anything beyond testing, run the checker in a worker thread.

import { randomUUID } from 'node:crypto';
import { SCOPE, ENVIRONMENTS } from '../content/dpp/lib/dpp-auth.mjs';

export const PRODUCT_GROUPS = [{ code: 'BATTERIES', label: 'Batteries', productSubGroups: [
  { code: 'EV', label: 'Electric vehicle batteries' }, { code: 'LMT', label: 'Light means of transport batteries' },
  { code: 'IND', label: 'Industrial batteries (over 2 kWh)' }] }];

// issuer: from createTestIssuer(); checker: a dpp-check Checker; resolve(upi): URL to fetch it from
// (default: the UPI itself); org: the verified org-identifier the operator's tokens carry.
// clients: optional { [clientId]: { jwk } } service accounts (public keys, ES256/384/512). When given,
// the API requires access tokens issued by /oauth2/token; otherwise any Bearer value is accepted.
export function createMockRegistry({ issuer, checker, org = 'ORG-TEST-0001', environment = 'acceptance', resolve = (u) => u,
  fetchImpl = globalThis.fetch, processingDelayMs = 0, maxBodyBytes = 1_000_000, clients = null }) {
  const tasks = new Map(), idem = new Map();
  const iss = ENVIRONMENTS[environment].issuer;
  const RESOURCE = `${iss}/resources/dpp/registry`;
  const seenJti = new Set();
  const CURVES = { ES256: ['P-256', 'SHA-256', 64], ES384: ['P-384', 'SHA-384', 96], ES512: ['P-521', 'SHA-512', 132] };
  const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
  const parseJwt = (t) => { const [h, p, sg] = String(t).split('.'); return { h: JSON.parse(Buffer.from(h, 'base64url')), p: JSON.parse(Buffer.from(p, 'base64url')), sig: b64(sg || ''), input: `${h}.${p}` }; };
  async function verifyWith(jwk, alg, j) {
    const c = CURVES[alg]; if (!c || j.sig.length !== c[2]) return false;
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: c[0], x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: c[0] }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: c[1] }, key, j.sig, new TextEncoder().encode(j.input));
  }
  // service-account token endpoint (Service Account guide, chapter 5)
  async function tokenEndpoint(form) {
    const bad = (error, error_description) => ({ status: 400, body: { error, error_description } });
    if (form.get('grant_type') !== 'client_credentials') return bad('unsupported_grant_type', 'grant_type must be client_credentials');
    if (form.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') return bad('invalid_request', 'client_assertion_type');
    if (form.get('resource') !== RESOURCE) return bad('invalid_target', `resource must be ${RESOURCE}`);
    const id = form.get('client_id'), c = clients?.[id];
    let j; try { j = parseJwt(form.get('client_assertion')); } catch { return { status: 401, body: { error: 'invalid_client', error_description: 'malformed assertion' } }; }
    const now = Math.floor(Date.now() / 1000), p = j.p;
    const why = !c ? 'unknown client' : j.h.typ !== 'client-authentication+jwt' ? 'typ' : j.h.kid !== c.kid ? 'kid' : !(await verifyWith(c.jwk, j.h.alg, j)) ? 'signature'
      : p.iss !== id || p.sub !== id ? 'iss/sub' : p.aud !== iss ? 'aud' : !(p.exp > now && p.iat <= now + 60 && p.exp - p.iat <= 300) ? 'iat/exp'
      : !p.jti || seenJti.has(p.jti) ? 'jti reused' : null;
    if (why) return { status: 401, body: { error: 'invalid_client', error_description: why } };
    seenJti.add(p.jti);
    const at = await issuer.sign({ iss, sub: id, client_id: id, aud: RESOURCE, scope: form.get('scope') || 'dpp:registry:write', iat: now, exp: now + 900, jti: 'at_' + randomUUID() }, { typ: 'at+jwt' });
    return { status: 200, body: { access_token: at, token_type: 'Bearer', expires_in: 900, scope: form.get('scope') || 'dpp:registry:write' } };
  }
  async function authorized(header) {
    const m = /^Bearer (\S+)$/i.exec(header || ''); if (!m) return false;
    if (!clients) return true;
    try {
      const j = parseJwt(m[1]); const now = Math.floor(Date.now() / 1000);
      return j.p.iss === iss && j.p.aud === RESOURCE && j.p.exp > now && clients[j.p.client_id] && await verifyWith(issuer.jwks.keys[0], 'ES384', j);
    } catch { return false; }
  }
  const now = () => new Date().toISOString();
  const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
  const error = (res, status, message, correlationId, extra = {}) => json(res, status, { message, status, correlationId, timestamp: now(), ...extra });

  async function readBody(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > maxBodyBytes) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks).toString('utf8');
  }
  function validate(body) {
    if (!body || typeof body !== 'object') return 'body must be a JSON object';
    const pg = PRODUCT_GROUPS.find((g) => g.code === body.productGroup);
    if (!pg) return `productGroup must be one of ${PRODUCT_GROUPS.map((g) => g.code).join(', ')}`;
    if (!pg.productSubGroups.some((s) => s.code === body.productSubGroup)) return `productSubGroup must be one of ${pg.productSubGroups.map((s) => s.code).join(', ')}`;
    const items = body.submissionItems;
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) return 'submissionItems must contain between 1 and 100 items';
    for (const [i, it] of items.entries()) {
      if (typeof it?.uniqueProductIdentifier !== 'string' || !/^https:\/\/./.test(it.uniqueProductIdentifier) || it.uniqueProductIdentifier.length > 2000) return `submissionItems[${i}].uniqueProductIdentifier must be an https URL`;
      if (!['item', 'batch', 'model'].includes(it.granularity)) return `submissionItems[${i}].granularity must be item, batch or model`;
    }
    return null;
  }
  async function token(upi) {
    const origin = new URL(upi).origin;
    return issuer.sign(issuer.claims({ issuer: iss, origin, org }));
  }
  async function processItem(task, it, i) {
    const details = [];
    const msg = (code, message) => details.push({ code, message });
    const url = resolve(it.uniqueProductIdentifier);
    let pub, full;
    try {
      const r1 = await fetchImpl(url, { redirect: 'manual' });
      if (r1.status !== 200) msg('UPI_PUBLIC_FETCH_FAILED', `anonymous request returned ${r1.status}`); else pub = await r1.json();
      const r2 = await fetchImpl(url, { redirect: 'manual', headers: { Authorization: `Bearer ${await token(it.uniqueProductIdentifier)}` } });
      if (r2.status !== 200) msg('UPI_PROTECTED_FETCH_FAILED', `authorized request returned ${r2.status}`); else full = await r2.json();
    } catch (e) { msg('UPI_UNREACHABLE', `could not fetch the passport: ${e.message}`); }
    if (full) {
      const r = await checker.check(full, { view: 'all' });
      if (r.verdict !== 'passes') msg('SEMANTIC_VALIDATION_FAILED', `${r.problems.length} problem(s): ${[...new Set(r.problems.map((p) => p.code))].slice(0, 5).join(', ')}`);
      if (full.granularity && !String(full.granularity).endsWith('#' + it.granularity)) msg('GRANULARITY_MISMATCH', `submitted ${it.granularity}, passport says ${String(full.granularity).replace(/.*#/, '')}`);
    }
    if (pub) {
      const r = await checker.check(pub, { view: 'pub' });
      if (r.verdict !== 'passes') msg('PUBLIC_VIEW_INVALID', `public view: ${r.problems.length} problem(s)`);
    }
    return {
      taskId: task.taskId, taskItemIndex: i, taskType: 'DPP_REGISTRATION',
      outcomeMessage: details.length ? { code: 'NON_COMPLIANT', message: 'The item did not pass validation' } : { code: 'COMPLIANT', message: 'The item passed validation' },
      outcomeDetails: details,
      specificTaskItemData: { uniqueProductIdentifier: it.uniqueProductIdentifier, productGroup: task.specificTaskData.productGroup,
        productSubGroup: task.specificTaskData.productSubGroup, submissionRequestId: task.specificTaskData.submissionRequestId,
        granularityLevel: it.granularity, ...(it.batchIdentifier ? { batchIdentifier: it.batchIdentifier } : {}), ...(it.modelIdentifier ? { modelIdentifier: it.modelIdentifier } : {}) },
      _ok: !details.length,
    };
  }
  async function processTask(task, body) {
    await new Promise((r) => setTimeout(r, processingDelayMs));
    task.status = 'PROCESSING';
    task.items = [];
    for (const [i, it] of body.submissionItems.entries()) task.items.push(await processItem(task, it, i));
    const bad = task.items.filter((x) => !x._ok).length;
    if (!bad) for (const x of task.items) x.specificTaskItemData.uniqueRegistryIdentifier = 'urn:mock-registry:' + randomUUID();
    task.specificTaskData.processingInfo = { submittedItems: task.items.length, compliantItems: task.items.length - bad, nonCompliantItems: bad };
    task.outcome = bad ? { outcomeResult: 'FAILED', outcomeMessage: { code: 'REJECTED', message: 'DPP submission contains non-compliant items' } }
      : { outcomeResult: 'SUCCEEDED', outcomeMessage: { code: 'REGISTERED', message: 'All submitted DPPs were registered' } };
    task.status = 'COMPLETED'; task.completedAt = now();
  }
  const publicTask = (t, extended = true) => {
    const { items, _body, ...rest } = t;
    return extended ? rest : (({ outcome, specificTaskData, ...row }) => row)(rest);
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const correlationId = String(req.headers['x-correlation-id'] || 'corr_' + randomUUID().slice(0, 8)).slice(0, 128);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth2/jwks') return json(res, 200, issuer.jwks, { 'Cache-Control': 'max-age=300' });
      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        const r = await tokenEndpoint(new URLSearchParams(await readBody(req)));
        return json(res, r.status, r.body, { 'Cache-Control': 'no-store' });
      }
      if (!(await authorized(req.headers.authorization))) return error(res, 401, 'Unauthorized', correlationId);
      if (req.method === 'GET' && url.pathname === '/api/v1/dpp/product-groups') return json(res, 200, PRODUCT_GROUPS);
      if (req.method === 'POST' && url.pathname === '/api/v1/dpp/submission') {
        const key = req.headers['idempotency-key'];
        if (!key || key.length > 128) return error(res, 400, 'Idempotency-Key header is required (at most 128 characters)', correlationId);
        const raw = await readBody(req);
        let body; try { body = JSON.parse(raw); } catch { return error(res, 400, 'Body is not valid JSON', correlationId); }
        const prior = idem.get(key);
        if (prior) {
          if (prior.raw !== raw) return error(res, 409, 'Idempotency-Key reused with a different request', correlationId, { code: 'CONFLICT', subCode: 'IDEMPOTENCY_KEY_REUSED' });
          return json(res, 202, prior.accepted, { Location: `/api/v1/tasks/${prior.accepted.taskId}` });
        }
        const problem = validate(body);
        if (problem) return error(res, 400, problem, correlationId);
        const taskId = 'task_' + randomUUID().replace(/-/g, '').slice(0, 16);
        const task = { taskId, taskType: 'DPP_REGISTRATION', correlationId, status: 'PENDING', actor: 'mock-service-account',
          organisationId: org, submittedAt: now(), completedAt: null,
          specificTaskData: { productGroup: body.productGroup, productSubGroup: body.productSubGroup, submissionRequestId: 'reg_' + randomUUID().slice(0, 12) } };
        tasks.set(taskId, task);
        const accepted = { taskId, submittedAt: task.submittedAt, taskType: 'DPP_REGISTRATION', correlationId, estimatedPeriodCompletionTime: 'PT10S' };
        idem.set(key, { raw, accepted });
        processTask(task, body).catch((e) => { task.status = 'ERROR'; task.completedAt = now(); task.outcome = { outcomeMessage: { code: 'TECHNICAL_ERROR', message: e.message } }; });
        return json(res, 202, accepted, { Location: `/api/v1/tasks/${taskId}` });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/tasks') {
        const all = [...tasks.values()].reverse();
        const page = Math.max(0, Number(url.searchParams.get('page') || 0)), size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') || 25)));
        const extended = url.searchParams.get('extended') === 'true';
        return json(res, 200, { page, size, totalElements: all.length, content: all.slice(page * size, page * size + size).map((t) => publicTask(t, extended)) });
      }
      const m = /^\/api\/v1\/tasks\/([^/]+)(\/items)?$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const t = tasks.get(m[1]);
        if (!t) return error(res, 404, 'Task not found', correlationId);
        if (!m[2]) return json(res, 200, publicTask(t));
        const items = (t.items || []).map(({ _ok, ...x }) => x);
        const page = Math.max(0, Number(url.searchParams.get('page') || 0)), size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') || 25)));
        return json(res, 200, { page, size, totalElements: items.length, content: items.slice(page * size, page * size + size) });
      }
      return error(res, 404, 'Not found', correlationId);
    } catch (e) {
      if (!e.status && process.env.DPP_MOCK_DEBUG) console.error(e);
      return error(res, e.status || 500, e.status === 413 ? 'Payload too large' : 'Technical error', correlationId);
    }
  };
}
export { SCOPE };
