// dpp-host: a reference DPP server for an economic operator (or a hosting provider acting
// for one). It serves each passport at its unique product identifier, following the EC
// DPP Registry Self-Hosting Authentication Guide:
//   - no Authorization header: 200 with the public view only;
//   - a valid Registry access token for the right requestor: 200 with the full passport;
//   - an Authorization header with a bad token: 401, never a fallback to the public view;
//   - a valid token with the wrong scope or requestor: 403 with no protected content.
// Responses carry Vary: Authorization; authorized ones are never cached. Run it behind a TLS
// terminator and set trustProxy so that X-Forwarded-Proto counts as HTTPS.
//
//   import http from 'node:http';
//   http.createServer(createHost({ origin, environment: 'acceptance', passports, requestorFor, fetchJwks })).listen(8080);

import { readFile } from 'node:fs/promises';
import { createChecker } from '../content/dpp/lib/dpp-auth.mjs';
import { viewFor } from '../content/dpp/components/dpp-model.mjs';

const terms = JSON.parse(await readFile(new URL('../content/dpp/components/ec-1.0.0-terms.json', import.meta.url), 'utf8'));

// passports: Map of URL path (e.g. '/dpp/demo-001') -> passport object
// requestorFor(path, passport): the expected { type: 'ORG_IDENTIFIER', value } from local policy
export function createHost({ origin, environment = 'acceptance', issuer, jwks, fetchJwks, passports, requestorFor, trustProxy = false, log = () => {} }) {
  const checker = createChecker({ environment, issuer, origin, jwks, fetchJwks });
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body === null ? '' : JSON.stringify(body, null, 1));
  };
  return async function handler(req, res) {
    const https = req.socket.encrypted || (trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { message: 'Method not allowed', status: 405 }, { Allow: 'GET, HEAD' });
    const passport = passports.get(path);
    if (!passport) return send(res, 404, { message: 'Not found', status: 404 });
    // the expected requestor comes from local policy, never from the request
    const d = await checker.decide({ https, authorization: req.headers.authorization ?? null,
      expectedRequestor: () => requestorFor(path, passport) });
    // log the decision, never the token
    log({ path, status: d.status, step: d.step, reason: d.reason });
    if (d.status === 'reject') return send(res, 421, { message: 'HTTPS required', status: 421 });
    if (d.status === 401) return send(res, 401, { message: 'Unauthorized', status: 401 }, { 'WWW-Authenticate': d.wwwAuthenticate, 'Cache-Control': 'no-store' });
    if (d.status === 403) return send(res, 403, { message: 'Forbidden', status: 403 }, { 'WWW-Authenticate': d.wwwAuthenticate, 'Cache-Control': 'no-store' });
    if (d.representation === 'full') return send(res, 200, req.method === 'HEAD' ? null : passport, { 'Cache-Control': 'no-store' });
    return send(res, 200, req.method === 'HEAD' ? null : viewFor(passport, 'pub', terms), { 'Cache-Control': 'public, max-age=300' });
  };
}
