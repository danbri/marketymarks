# marketymarks
E-commerce linked information systems

## Site

Built with [Eleventy](https://www.11ty.dev/). Source in `site/content/`, output to `site/www/`.

```bash
cd site
npm install
npm run build   # generate site/www/
npm run serve   # local dev server
```

## DPP Checker (`/dpp/check/`)

Checks an EU Digital Product Passport (EC JSON) against the European
Commission's published semantic data artifacts (release 1.0.0), in the browser,
using [`@factoidal/core`](https://www.npmjs.com/package/@factoidal/core) from
jsDelivr.

- `site/content/dpp/lib/dpp-check.mjs`: the checker (same code in browser and Node)
- `site/content/dpp/ec/1.0.0/`: unchanged copy of the EC files (EUPL-1.2, see `NOTICE.md`)
- `site/test/dpp-check.test.mjs`: every EC sample must pass and every
  deliberately broken passport must fail (`cd site && npm test`; also run in CI before deploy)

## Command line (`site/bin/dpp.mjs`)

Run `cd site && npm install`, then `npx dpp …`:
- `check`, `show`, `self-test`;
- `keygen`, `sign`, `verify`;
- `token`;
- `serve` (reference passport host) and `mock-registry`.

`npx dpp` alone prints the usage.
