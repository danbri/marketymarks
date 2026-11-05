# DPP checker: stack overflow on iPhone Safari (2026-11-05)

## Report

On a recent iPhone in Safari, one EC sample failed against one restricted view, and Self Test failed.
On the owner's iPhone, Self Test passed. The exact error text from the failing iPhone is not recorded.

## Reproduction

No iPhone was used. WebKit (Playwright build, macOS) with a reduced stack limit emulates the fault:
`JSC_maxPerThreadStackUsage` and `__XPC_JSC_maxPerThreadStackUsage`. A JS recursion probe confirmed that the setting
takes effect (depth 72,960 at the default 5 MB, 9,544 at 1 MB). The real iOS limit was not measured.
The JIT-off settings tried had no visible effect, so they show nothing about Lockdown Mode.

Live site, 20 EC samples x 5 views = 100 checks:

| Browser | Stack limit | Result |
|---|---|---|
| Chromium, Firefox, WebKit | default | no errors (Firefox and WebKit also ran 21 GBA passports x 5 views) |
| WebKit | 1 MB | the first 9 checks throw "Maximum call stack size exceeded", then the other 91 are correct |
| WebKit | 512 KB | the engine does not start; all 100 are reported as `JSON-LD` passport failures |

The first 9 checks fail in forward and in reverse sample order, so the passport does not decide the failure.
The likely reason is that cold wasm uses more stack than warmed-up wasm. This was not measured directly.

## Causes

1. **The regex REPLACE in `Checker.shapes()`.** All 18 traced errors were in the update that ran
   `^.*?\$this\s+(\S+)\s+\?value.*$` over the full text of a SHACL rule, inside Factoidal SPARQL `REPLACE`.
2. **Engine start.** Near 1 MB, start is unstable: it failed at 960 KB and 896 KB and passed at 832 KB and 1 MB.
   It failed at 768 KB, 640 KB, 576 KB and 512 KB.
3. **Wrong label.** `check()` caught every `jsonldToRdf` error as a passport problem, so an engine failure read as
   `fails` with code `JSON-LD`.

## Change

- The rewrite now runs in JavaScript. The engine only receives a `VALUES` list of old and new rule text.
- `check()` rethrows engine and stack errors. The page then shows "Could not check this passport" with the real message.

## Verification

- `npm test`: all suites pass.
- Local build, WebKit, 1 MB: 100 of 100 checks with no error. At 832 KB the same.
- Default stack: the 100 verdicts are the same on the live site and on the local build.
- Node, old and new checker, 41 passports x 5 views: 205 compared, 0 different (verdict, problems, notes).
- Not tested: a real iPhone.

## Factoidal fixes

- **0.31.0** (https://github.com/danbri/factoidal-core/releases/tag/v0.31.0). `cmatchE`, the ordered regex matcher, nested
  frames for each character of a star; a star over one character class is now a loop. `ofHex` decoded a test fixture
  at engine start, 1,024 frames deep; it is now a loop. A star over a group still recurses.
- **0.31.1** (https://github.com/danbri/factoidal-core/pull/356, in progress). Two more fixtures recursed at engine start:
  `swapLabelGo` and `bytesOfHexLiteral`.

Live site on 0.31.0, WebKit, 100 checks at each limit:

| Stack limit | Result |
|---|---|
| 5 MB, 1 MB, 768 KB | 0 errors, same verdicts |
| 640 KB | the engine does not start |

A native Lean test does not gate stack use: the old matcher passed it. The gate is `npm/factoidal/test/stack-use.test.mjs`,
which runs the wasm. Not tested: a real iPhone.
