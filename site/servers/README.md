# DPP servers (Node, no dependencies beyond this repo)

## `dpp-host.mjs`: a reference passport server for an economic operator

It serves each passport at the path of its unique product identifier and follows the EC DPP Registry Self-Hosting Authentication Guide.

| request | response |
|---|---|
| no `Authorization` header | `200`, the public view only (restricted fields removed using the EC access rights) |
| valid Registry token for the right requestor | `200`, the full passport, `Cache-Control: no-store` |
| `Authorization` present but the token is bad | `401` with `WWW-Authenticate`; never the public view |
| valid token, wrong scope or requestor | `403`, no protected content, and the expected requestor is not revealed |

- Every response carries `Vary: Authorization`.
- The expected requestor comes from your local policy (`requestorFor`), never from the request.
- The server logs decisions, never tokens.
- Run it behind TLS. With `trustProxy: true` it trusts `X-Forwarded-Proto: https`.

```js
import http from 'node:http';
import { createHost } from './dpp-host.mjs';
http.createServer(createHost({
  origin: 'https://dpp.example.com', environment: 'acceptance', trustProxy: true,
  passports,                                   // Map: '/path' -> passport JSON
  requestorFor: () => ({ type: 'ORG_IDENTIFIER', value: 'your-org-identifier' }),
  fetchJwks: () => fetch('https://auth.acc.product-passport.ec.europa.eu/oauth2/jwks').then((r) => r.json()),
})).listen(8080);
```

## `dpp-mock-registry.mjs`: a stand-in for the EU DPP Registry and Activity Dashboard

It is for testing your systems without EU Login or the EC Acceptance environment. It implements the EC public OpenAPI:
- product groups;
- submission (`Idempotency-Key`, 1–100 items, `202` with a task);
- tasks, task detail and per-item results.

It also publishes its own test signing key at `/oauth2/jwks`.

For each item it fetches the passport twice:
- anonymously, then checks the result against the EC public-view rules;
- with an ES384 Registry-style token, then checks the full passport against the EC rules and the submitted granularity.

Registration is all or nothing, as with the real Registry.

It is not the real Registry: there is no EU Login, no organisation verification and no proof of registration. Validation blocks the process for a few seconds per passport, so beyond testing, run the checker in a worker.

## Tests

`test/dpp-servers.test.mjs` wires both together on localhost and runs:
- the host's public / 401 / HTTP-refused / 404 cases;
- the registry API rules: 401, 400s, idempotency and 409;
- a good submission (all registered);
- failures, each of which fails the whole submission:
  - an EC rule error (the item names the EC error code);
  - a granularity mismatch;
  - a token for another organisation (the host returns 403);
- the paged task list.
