# DPP web components

Plain ES modules with no build step. Load them with:

```html
<script type="module" src="/dpp/components/dpp-elements.mjs"></script>
```

| element | shows |
|---|---|
| `<dpp-passport>` | one passport, readable: grouped by theme, with labels, units, codes, dates, countries and languages taken from the EC vocabularies |
| `<dpp-structured>` | one passport as a property/value ladder (after schema.org's "structured" example view) |
| `<dpp-views>` | tabs: Readable, Structured, JSON |
| `<dpp-collection>` | many passports, with search and five views: cards, compare table, one by one, map (OpenStreetMap), SPARQL |

Data can be passed in three ways:
- **`src` attribute:** a URL of passport JSON. For `<dpp-collection>`, a URL of a JSON array of passports, or of URLs.
- **`.passport` / `.passports` property** from script.
- **Inline:** a child `<script type="application/json">`, for `<dpp-passport>`.

```html
<dpp-passport src="/dpp/demo/demo-001.json"></dpp-passport>
<dpp-collection src="/dpp/demo/index.json"></dpp-collection>
```

Audiences: `<dpp-passport audience="pub">` shows only what that audience may see. The values are `all`, `pub`, `res1`, `res2` and `res3`, and access levels come from the EC vocabulary's `dct:accessRights`. `<dpp-views>` has an "As seen by" menu that applies to all three tabs. The test suite checks that no restricted field leaks into any audience's view of the EC samples.

Theming uses CSS custom properties: `--dpp-bg`, `--dpp-ink`, `--dpp-muted`, `--dpp-line`, `--dpp-soft`, `--dpp-edge` and `--dpp-font`. The defaults meet WCAG 2.2 AAA text contrast in light and dark mode.

## Files

| file | what it is |
|---|---|
| `dpp-model.mjs` | turns values into text for people (no RDF engine needed) |
| `ec-1.0.0-terms.json` | labels, definitions, units, access levels and legal references from the EC 1.0.0 vocabularies, built by `tools/build-dpp-terms.mjs` |
| `profiles/<product>.json` | presentation profiles: which fields go in the title, summary and each themed group |

The only profile so far is `profiles/batteries.json`. A new product group needs:
1. a profile;
2. its EC vocabulary added to the terms build.
