# DPP checker: reliability record (2026-11-05)

Page: https://marketymarks.com/dpp/check/ . See also `docs/ios-stack-overflow-20261105.md`.

## Tests run

- Desktop Chrome, live site: self-test 27 of 27 correct in 23 s, no console error except a favicon 404.
- Node: 40 checks in sequence, time (about 0.7 s) and memory (about 210 MB) stayed flat.
- Node: 22 hostile or malformed inputs.
- Other session, 2026-11-05: Chromium, Firefox and WebKit, 100 checks on default stack, no errors.

## Faults found

| Fault | When | Replicable | State |
|---|---|---|---|
| Stack overflow in Safari with a small stack | first checks after load, at a 1 MB stack limit | yes, in emulation (WebKit build) | fixed in 3dd09e0; not tested on a real iPhone |
| Engine does not start | stack limit near or below 1 MB | yes, in emulation (fails at 960, 896 and 768 KB and below) | open, needs a Factoidal change; the page now reports it as an engine fault |
| Page freezes | deep nesting: 3 s at depth 50, 44 s at depth 100, over 2 minutes at depth 200 | yes | guarded: over 16 levels gives "not checked" |
| Check crashes | list of about 4,000 items or more in Node (fewer on phones, not measured) | yes | guarded: over 2,000 items gives "not checked" |
| Wrong pass | `@included` in a passport hides content from the rules | yes | fixed: any `@` key fails with JSON-LD-KEYWORD |

## Root causes that remain in Factoidal

- Property-path evaluation is superlinear (the EC unknown-field rule). The site limit hides this; the fault remains.
- `jsonldToRdf` overflows the stack on long lists.
- SPARQL `REPLACE` with a long regex uses much stack.
- Engine start needs a large stack.
- A check blocks the main thread. There is no way to cancel it. A worker would keep the page live.

## Limits of this record

- No test on a real iPhone or Android phone.
- Memory on older phones is not measured. The engine is 31 MB of wasm.
- The list limit (2,000) and depth limit (16) are chosen values, with margin below the measured faults.
- A passport with `@context` or other `@` keys now fails. Use plain EC JSON.
