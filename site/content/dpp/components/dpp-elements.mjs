// DPP web components.
//   <dpp-passport>    one passport, readable, grouped by theme, labels from the EC vocabularies
//   <dpp-structured>  one passport as a property/value ladder (after schema.org's example
//                     "structured" view, from schemarama's pretty-markup, Apache-2.0, Google LLC)
//   <dpp-views>       tabs: Readable | Structured | schema.org | JSON
//   <dpp-collection>  many passports: search, cards, compare table, carousel, map, SPARQL
// Set data with the .passport / .passports properties, or a src attribute (URL of JSON;
// for a collection, a JSON array of passports or of URLs).
// Theme with CSS custom properties: --dpp-bg, --dpp-ink, --dpp-muted, --dpp-line,
// --dpp-soft, --dpp-font. Defaults meet WCAG 2.2 AAA text contrast in light and dark.

import {
  loadTerms, loadProfile, profileIdFor, subgroupOf, classify, textOf, fieldLabel, accessOf, ACCESS_LABELS,
  pickLang, userLangs, codeLabel, countryName, formatDate, formatQuantity, formatRange, describe, orderedKeys,
  pathValue, shortIri, COUNTRIES, viewFor, AUDIENCES, summarySentences, loadCrosswalk,
} from './dpp-model.mjs';
import { loadEngine } from './engine.mjs';
import { toSchemaOrg, PENDING, OFFLINE_CONTEXT } from './dpp-schemaorg.mjs';

const CSS = `
:host { --bg: var(--dpp-bg, #fff); --ink: var(--dpp-ink, #111); --muted: var(--dpp-muted, #555); --line: var(--dpp-line, #ddd);
  --soft: var(--dpp-soft, #f5f5f5); --edge: var(--dpp-edge, #767676);
  display: block; color: var(--ink); font: var(--dpp-font, 15px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace); }
@media (prefers-color-scheme: dark) { :host { --bg: var(--dpp-bg, #111); --ink: var(--dpp-ink, #e8e8e8); --muted: var(--dpp-muted, #b3b3b3);
  --line: var(--dpp-line, #333); --soft: var(--dpp-soft, #1c1c1c); --edge: var(--dpp-edge, #8a8a8a); } }
* { box-sizing: border-box; }
a { color: inherit; text-underline-offset: 3px; }
button, input, select, textarea { font: inherit; color: var(--ink); }
button { background: var(--bg); border: 1px solid var(--ink); padding: 3px 10px; cursor: pointer; }
button[aria-pressed="true"], button.on { background: var(--ink); color: var(--bg); }
input[type=search], select, textarea { background: var(--bg); border: 1px solid var(--edge); padding: 4px 6px; }
.muted { color: var(--muted); }
.lang { color: var(--muted); font-size: .8em; margin-left: .4em; }
h2 { font-size: 1.15rem; margin: 0; }
h3 { font-size: 1rem; margin: 1.2rem 0 .4rem; padding-bottom: .2rem; border-bottom: 1px solid var(--line); }
.head { margin-bottom: .6rem; }
.plain { margin: .4rem 0 .6rem; max-width: 60ch; }
.sub { color: var(--muted); }
.summary { display: flex; flex-wrap: wrap; gap: .4rem .6rem; margin: .6rem 0; padding: 0; list-style: none; }
.summary li { background: var(--soft); padding: .15rem .5rem; }
.summary b { font-weight: 400; color: var(--muted); }
dl { margin: 0; display: grid; grid-template-columns: minmax(10rem, 16rem) 1fr; gap: .25rem 1rem; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
dl dl { grid-template-columns: minmax(8rem, 12rem) 1fr; padding-left: .6rem; border-left: 2px solid var(--line); }
dd ul { margin: 0; padding-left: 1.1rem; }
.info { border: 0; padding: 0 .2rem; background: none; color: var(--muted); cursor: help; text-decoration: underline dotted; }
.note { grid-column: 1 / -1; background: var(--soft); padding: .4rem .6rem; font-size: .85em; }
.note ul { margin: .2rem 0 0; padding-left: 1.1rem; } .note code { font: inherit; overflow-wrap: anywhere; }
.restricted { font-size: .75em; border: 1px solid var(--edge); padding: 0 .3rem; margin-left: .3rem; color: var(--muted); }
details.other > summary { cursor: pointer; color: var(--muted); }
@media (max-width: 600px) { dl, dl dl { grid-template-columns: 1fr; } dd { margin-bottom: .4rem; } }
`;
let sheet;
function styles(root, extra = '') {
  if ('adoptedStyleSheets' in Document.prototype && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    sheet ??= (() => { const s = new CSSStyleSheet(); s.replaceSync(CSS); return s; })();
    const sheets = [sheet];
    if (extra) { const e = new CSSStyleSheet(); e.replaceSync(extra); sheets.push(e); }
    root.adoptedStyleSheets = sheets;
  } else {
    const st = document.createElement('style'); st.textContent = CSS + extra; root.append(st);
  }
}
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
async function fetchJson(src) { const r = await fetch(src); if (!r.ok) throw new Error(`${src}: ${r.status}`); return r.json(); }

// ---- value rendering ----------------------------------------------------------
function renderValue(key, v, terms, langs) {
  switch (classify(key, v, terms)) {
    case 'empty': return el('span', { class: 'muted', text: '—' });
    case 'boolean': return document.createTextNode(v ? 'Yes' : 'No');
    case 'number': return document.createTextNode(textOf(key, v, terms, langs));
    case 'date': return el('time', { datetime: v, text: formatDate(v, langs) });
    case 'country': return el('span', { title: v, text: countryName(v, langs) });
    case 'code': {
      const c = terms.codes[v];
      return el('span', { title: [c?.definition, v].filter(Boolean).join('\n'), text: codeLabel(v, terms) });
    }
    case 'link': {
      const label = v.startsWith('mailto:') ? v.slice(7) : v;
      // example.org/com and the EC repository host (which does not resolve yet) are shown as text, not links
      return /^https?:\/\/((www\.)?example\.(org|com)|repository\.product-passport\.ec\.europa\.eu)\//.test(v) ? el('span', { text: label }) : el('a', { href: v, rel: 'noopener', target: '_blank', text: label });
    }
    case 'langtext': {
      const { lang, text } = pickLang(v, langs);
      const others = Object.keys(v).filter((k) => k !== lang);
      return el('span', {}, text, el('span', { class: 'lang', title: 'language of this text', text: lang }),
        others.length ? el('span', { class: 'lang', text: `+${others.length} other language${others.length > 1 ? 's' : ''}`, title: others.join(', ') }) : null);
    }
    case 'quantity': return document.createTextNode(formatQuantity(v, terms, langs));
    case 'range': return document.createTextNode(formatRange(v, terms, langs));
    case 'document': return el('span', {}, el('a', { href: v.url, rel: 'noopener', target: '_blank', text: v.resourceTitle || v.url }),
      v.contentType ? el('span', { class: 'lang', text: v.contentType.replace('application/', '') }) : null,
      v.language ? el('span', { class: 'lang', text: v.language }) : null);
    case 'list': {
      if (v.length === 1) return renderValue(key, v[0], terms, langs);
      return el('ul', {}, v.map((x) => el('li', {}, renderValue(key, x, terms, langs))));
    }
    case 'record': return renderFields(v, Object.keys(v), terms, langs);
    default: return document.createTextNode(String(v));
  }
}
function renderFields(obj, keys, terms, langs) {
  const dl = el('dl');
  for (const k of keys) {
    if (!(k in obj)) continue;
    const f = terms.fields[k];
    const access = accessOf(k, terms);
    const dt = el('dt', {}, fieldLabel(k, terms));
    if (Array.isArray(access) && access.length) dt.append(el('span', { class: 'restricted', title: access.map((a) => ACCESS_LABELS[a]).join('\n'), text: 'restricted' }));
    if (f?.definition) {
      const xw = terms._crosswalk?.fields?.[k];
      const note = el('div', { class: 'note', hidden: true }, f.definition,
        f.legal ? el('div', { class: 'muted', text: f.legal }) : null,
        xw ? el('div', { class: 'xw' }, el('div', { class: 'muted', text: 'In other models:' }),
          el('ul', {}, Object.entries(xw).flatMap(([t, ms]) => ms.map((m) => el('li', {},
            `${terms._crosswalk.targets[t].label} ${terms._crosswalk.targets[t].version}: `, el('code', { text: m.path }),
            el('span', { class: 'muted', text: ` (${m.match})${m.note ? ' — ' + m.note : ''}` })))))) : null);
      const btn = el('button', { class: 'info', type: 'button', 'aria-expanded': 'false', title: 'What is this?', text: '?' });
      btn.addEventListener('click', () => { note.hidden = !note.hidden; btn.setAttribute('aria-expanded', String(!note.hidden)); });
      dt.append(' ', btn);
      dl.append(dt, el('dd', {}, renderValue(k, obj[k], terms, langs)), note);
    } else {
      dl.append(dt, el('dd', {}, renderValue(k, obj[k], terms, langs)));
    }
  }
  return dl;
}

// ---- <dpp-passport> ------------------------------------------------------------
class DppPassport extends HTMLElement {
  static observedAttributes = ['src', 'lang', 'audience'];
  #passport = null;
  constructor() { super(); this.attachShadow({ mode: 'open' }); styles(this.shadowRoot); }
  get passport() { return this.#passport; }
  set passport(p) { this.#passport = p; this.render(); }
  async attributeChangedCallback(name) {
    if (name === 'src' && this.getAttribute('src')) this.passport = await fetchJson(this.getAttribute('src'));
    else this.render();
  }
  connectedCallback() {
    if (!this.#passport && !this.getAttribute('src')) {
      const s = this.querySelector('script[type="application/json"], script[type="application/ld+json"]');
      if (s) this.passport = JSON.parse(s.textContent);
    }
  }
  async render() {
    const full = this.#passport; if (!full) return;
    const langs = this.getAttribute('lang') ? [this.getAttribute('lang')] : userLangs();
    const [terms, profile, crosswalk] = await Promise.all([loadTerms(), loadProfile(profileIdFor(full)), loadCrosswalk()]);
    terms._crosswalk ??= crosswalk;
    const audience = this.getAttribute('audience') || 'all';
    const p = viewFor(full, audience, terms);
    const d = describe(p, profile, terms, langs);
    const root = this.shadowRoot; root.replaceChildren();
    const head = el('div', { class: 'head', part: 'head' }, el('h2', { text: d.title }),
      d.subtitle ? el('div', { class: 'sub', text: d.subtitle }) : null,
      d.maker && d.maker !== d.title ? el('div', { class: 'sub', text: d.maker }) : null);
    const chips = el('ul', { class: 'summary', part: 'summary' });
    for (const path of profile.summary || []) {
      const v = pathValue(p, path); if (v == null) continue;
      chips.append(el('li', {}, el('b', { text: fieldLabel(path.split('.').pop(), terms) + ': ' }), textOf(path, v, terms, langs)));
    }
    const plain = summarySentences(p, profile, terms, langs);
    root.append(head, plain.length ? el('p', { class: 'plain', part: 'plain' }, plain.join(' ')) : null, chips);
    if (audience !== 'all') {
      const hidden = Object.keys(full).length - Object.keys(p).length;
      root.append(el('p', { class: 'muted', text: `Shown as seen by: ${AUDIENCES.find(([k]) => k === audience)?.[1] || audience}.${hidden ? ` ${hidden} top-level field${hidden > 1 ? 's' : ''} hidden.` : ''}` }));
    }
    const used = new Set();
    for (const g of profile.groups || []) {
      const keys = g.fields.filter((k) => k in p);
      if (!keys.length) continue;
      keys.forEach((k) => used.add(k));
      root.append(el('section', { part: 'group', 'data-group': g.id }, el('h3', { text: g.title }), renderFields(p, keys, terms, langs)));
    }
    const rest = Object.keys(p).filter((k) => !used.has(k));
    if (rest.length) root.append(el('details', { class: 'other' }, el('summary', { text: `Other details (${rest.length})` }), renderFields(p, rest, terms, langs)));
  }
}

// ---- <dpp-structured>: schemarama-style ladder ----------------------------------------
const LADDER_CSS = `
.row { display: flex; justify-content: space-between; gap: 1rem; padding: 4px 8px; border-bottom: 1px solid var(--line); }
.pred { display: flex; font-weight: 700; min-width: 0; }
.bar { flex: none; margin-right: 4px; }
.obj { width: 58%; overflow-wrap: anywhere; }
.row.top { background: var(--soft); }
`;
class DppStructured extends HTMLElement {
  static observedAttributes = ['src'];
  #passport = null;
  constructor() { super(); this.attachShadow({ mode: 'open' }); styles(this.shadowRoot, LADDER_CSS); }
  set passport(p) { this.#passport = p; this.render(); }
  get passport() { return this.#passport; }
  async attributeChangedCallback() { if (this.getAttribute('src')) this.passport = await fetchJson(this.getAttribute('src')); }
  async render() {
    const p = this.#passport; if (!p) return;
    const terms = await loadTerms();
    const rows = [];
    let hue = 210;
    const nextHue = () => (hue = (hue + 137.508) % 360);
    const iriOf = (k) => terms.fields[k]?.iri ? shortIri(terms.fields[k].iri) : k;
    const row = (level, color, pred, obj, lang, top) => {
      const bar = el('div', { class: 'bar', style: `width:${level * 24}px;border-right:3px solid hsl(${color} 55% 55%)` });
      rows.push(el('div', { class: 'row' + (top ? ' top' : '') }, el('div', { class: 'pred' }, bar, el('div', { text: pred })),
        el('div', { class: 'obj' }, lang ? el('span', { class: 'lang', text: '@' + lang + ' ' }) : null, obj)));
    };
    const walk = (obj, level, color) => {
      for (const [k, v] of Object.entries(obj)) {
        const vals = Array.isArray(v) ? v : [v];
        for (const x of vals) {
          if (x && typeof x === 'object' && !Array.isArray(x)) {
            const kind = classify(k, x, terms);
            if (kind === 'langtext') { for (const [l, t] of Object.entries(x)) row(level, color, iriOf(k), t, l); continue; }
            row(level, color, iriOf(k), '');
            walk(x, level + 1, nextHue());
          } else {
            const s = typeof x === 'string' && terms.codes[x] ? shortIri(x) : String(x);
            row(level, color, iriOf(k), s);
          }
        }
      }
    };
    const top = nextHue();
    if (p.digitalProductPassportId) row(0, top, '@id', p.digitalProductPassportId, null, true);
    row(0, top, '@type', 'dpp:DigitalProductPassport', null, true);
    walk(p, 0, top);
    this.shadowRoot.replaceChildren(...rows);
  }
}

// ---- <dpp-views>: Readable | Structured | JSON ----------------------------------------
const TABS_CSS = `
[role=tablist] { display: flex; gap: .4rem; margin-bottom: .8rem; flex-wrap: wrap; }
pre { background: var(--soft); padding: .6rem; overflow: auto; font-size: 12px; margin: 0; max-height: 70vh; }
.srow { display: flex; justify-content: space-between; gap: 1rem; padding: 3px 6px; border-bottom: 1px solid var(--line); }
.srow > div:first-child { font-weight: 700; } .srow > div:last-child { width: 55%; overflow-wrap: anywhere; }
`;
class DppViews extends HTMLElement {
  static observedAttributes = ['src'];
  #passport = null; #tab = 'readable';
  constructor() { super(); this.attachShadow({ mode: 'open' }); styles(this.shadowRoot, TABS_CSS); }
  set passport(p) { this.#passport = p; this.render(); }
  get passport() { return this.#passport; }
  async attributeChangedCallback() { if (this.getAttribute('src')) this.passport = await fetchJson(this.getAttribute('src')); }
  async render() {
    const full = this.#passport; if (!full) return;
    // every tab shows only what the chosen audience may see
    const p = viewFor(full, this.audience || 'all', await loadTerms());
    const tabs = [['readable', 'Readable'], ['structured', 'Structured'], ['schemaorg', 'schema.org'], ['json', 'JSON']];
    if (this.source) tabs.push(['source', 'Source']);
    if (this.#tab === 'source' && !this.source) this.#tab = 'readable';
    const bar = el('div', { role: 'tablist' }, tabs.map(([id, label]) => el('button', {
      role: 'tab', 'aria-selected': String(id === this.#tab), class: id === this.#tab ? 'on' : null, text: label,
      onclick: () => { this.#tab = id; this.render(); },
    })));
    const aud = el('select', { 'aria-label': 'Show the passport as seen by', onchange: (e) => { this.audience = e.target.value; this.render(); } },
      AUDIENCES.map(([k, label]) => el('option', { value: k, selected: k === (this.audience || 'all') || null, text: 'As seen by: ' + label })));
    bar.append(aud);
    let body;
    if (this.#tab === 'readable') { body = el('dpp-passport', { audience: this.audience || 'all' }); body.passport = full; } // it filters, and says how much it hid
    else if (this.#tab === 'structured') { body = el('dpp-structured'); body.passport = p; }
    else if (this.#tab === 'schemaorg') body = await schemaOrgPanel(p);
    else if (this.#tab === 'source') body = sourcePanel(this.source);
    else body = el('pre', { text: JSON.stringify(p, null, 2) });
    this.shadowRoot.replaceChildren(bar, el('div', { role: 'tabpanel' }, body));
  }
}

// where a passport came from, and the source's own fields (for data mapped from another format)
function sourcePanel(it) {
  const src = it.source || {};
  const parts = [el('dl', {},
    el('dt', { text: 'Origin' }), el('dd', { text: originOf(it) }),
    src.name ? [el('dt', { text: 'Source' }), el('dd', { text: src.name })] : null,
    src.url ? [el('dt', { text: 'Original page' }), el('dd', {}, el('a', { href: src.url, rel: 'noopener', target: '_blank', text: src.url }))] : null,
    src.retrieved ? [el('dt', { text: 'Retrieved' }), el('dd', { text: src.retrieved })] : null,
    el('dt', { text: 'Licence' }), el('dd', { text: src.licence || (originOf(it) === 'EC sample' ? 'EUPL-1.2 (EC files)' : originOf(it) === 'fictional demo' ? 'fictional data' : 'none stated') }))];
  if (it.raw) {
    const fields = Object.entries(it.raw).filter(([, v]) => v != null && typeof v !== 'object');
    parts.push(el('h3', { text: 'As published by the source' }),
      el('p', { class: 'muted', text: 'Field names and values exactly as on the original page. Those with an EC field are also in the other tabs; the rest have no place in the EC model yet.' }),
      el('dl', {}, fields.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })])));
    if (it.raw.provenance?.length) {
      parts.push(el('h3', { text: 'Where the materials came from' }), el('dl', {}, it.raw.provenance.flatMap((pv) => [
        el('dt', { text: pv.material }),
        el('dd', {}, pv.countries?.length ? el('ul', {}, pv.countries.map(([c, share]) => el('li', { text: `${c}: ${share}` }))) : el('span', { class: 'muted', text: `supply chain mapped: ${pv.supplyChainMapped || 'not stated'}` }))])));
    }
  }
  return el('div', {}, parts);
}
function originOf(it) {
  return it.origin || (/global battery/i.test(it.source?.name || '') ? 'GBA pilot' : /\/demo\//.test(it.source?.url || '') ? 'fictional demo'
    : /\/ec\/1\.0\.0\//.test(it.source?.url || '') ? 'EC sample' : 'other');
}

// the passport as schema.org (with the pending Digital Product Passport terms marked)
async function schemaOrgPanel(p) {
  const terms = await loadTerms(), profile = await loadProfile(profileIdFor(p));
  const so = toSchemaOrg(p, terms, profile, userLangs());
  const used = new Set();
  const walk = (o) => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (PENDING.has(k)) used.add(k); if (k === '@type' && PENDING.has(v)) used.add(v); walk(v); } };
  walk(so);
  const rows = [];
  const ladder = (o, level, hue) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === '@context') continue;
      for (const x of Array.isArray(v) ? v : [v]) {
        const bar = el('span', { style: `display:inline-block;width:${level * 20}px;border-right:3px solid hsl(${hue} 55% 55%);margin-right:4px;height:1em;vertical-align:middle` });
        const name = el('span', {}, k, PENDING.has(k) ? el('span', { class: 'restricted', title: 'pending.schema.org term (schema.org issue 4870)', text: 'pending' }) : null);
        if (x && typeof x === 'object') {
          rows.push(el('div', { class: 'srow' }, el('div', {}, bar, name), el('div', { class: 'muted' }, x['@type'] ? String(x['@type']) : '', PENDING.has(x['@type']) ? el('span', { class: 'restricted', text: 'pending' }) : null)));
          ladder(Object.fromEntries(Object.entries(x).filter(([kk]) => kk !== '@type')), level + 1, (hue + 137.5) % 360);
        } else rows.push(el('div', { class: 'srow' }, el('div', {}, bar, name), el('div', { text: String(x) })));
      }
    }
  };
  ladder(so, 0, 210);
  return el('div', {},
    el('p', { class: 'muted' }, 'The passport as schema.org markup, as a product page could publish it. ',
      used.size ? `Terms marked "pending" (${[...used].join(', ')}) are in schema.org's pending area, proposed for Digital Product Passports.` : ''),
    el('div', { class: 'ladder' }, rows),
    el('details', {}, el('summary', { text: 'JSON-LD' }), el('pre', { text: JSON.stringify(so, null, 2) })));
}

// ---- <dpp-collection> ---------------------------------------------------------------
const COLL_CSS = `
.bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
.bar input[type=search] { flex: 1 1 14rem; }
.count { color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: .8rem; }
.card { border: 1px solid var(--line); padding: .7rem .8rem; cursor: pointer; background: var(--bg); text-align: left; width: 100%; display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch; }
.card:hover, .card:focus-visible { border-color: var(--ink); }
.card h4 { margin: 0 0 .2rem; font-size: 1rem; }
.badge { font-size: .75em; color: var(--muted); border: 1px solid var(--edge); align-self: flex-start; padding: 0 .35rem; margin-bottom: .3rem; }
.card ul { list-style: none; padding: 0; margin: .4rem 0 0; font-size: .85em; }
.card li b { font-weight: 400; color: var(--muted); }
mark { background: #ffe066; color: #111; }
.tablewrap { overflow: auto; max-height: 75vh; border: 1px solid var(--line); }
table { border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; min-width: 7rem; max-width: 14rem; }
thead th { position: sticky; top: 0; background: var(--bg); z-index: 1; }
tbody th { position: sticky; left: 0; background: var(--bg); color: var(--muted); font-weight: 400; min-width: 13rem; }
tr.diff td { background: var(--soft); }
td { overflow-wrap: anywhere; }
td .bar { display: block; height: 4px; background: var(--ink); margin-top: 3px; }
.carousel { display: grid; grid-template-columns: auto 1fr auto; gap: .6rem; align-items: start; }
.dots { text-align: center; color: var(--muted); margin-top: .6rem; }
#map { height: 60vh; min-height: 320px; border: 1px solid var(--line); }
.sparql textarea { width: 100%; min-height: 12rem; font-size: 12px; }
.sparql .row { display: flex; gap: .5rem; flex-wrap: wrap; margin: .5rem 0; align-items: center; }
dialog { border: 1px solid var(--ink); background: var(--bg); color: var(--ink); width: min(60rem, 96vw); max-height: 92vh; padding: 1rem; }
dialog::backdrop { background: rgb(0 0 0 / .5); }
.close { float: right; }
`;
const MODES = [['cards', 'Cards'], ['compare', 'Compare'], ['carousel', 'One by one'], ['map', 'Map'], ['sparql', 'SPARQL']];

class DppCollection extends HTMLElement {
  static observedAttributes = ['src'];
  #items = []; #mode = 'cards'; #query = ''; #index = 0; #onlyDiff = false; #terms = null; #profiles = {};
  constructor() { super(); this.attachShadow({ mode: 'open' }); styles(this.shadowRoot, COLL_CSS); }
  // passports: array of passport objects, or {passport, label?, source?}
  set passports(list) { this.#items = list.map((x, i) => (x && x.passport ? { ...x } : { passport: x })).map((x, i) => ({ ...x, n: i })); this.render(); }
  get passports() { return this.#items.map((x) => x.passport); }
  // add passports, keeping each one's source information: items are passports or {passport, source, raw, origin, view, wave}
  addPassports(list) {
    const start = this.#items.length;
    this.#items = [...this.#items, ...list.map((x) => (x && x.passport ? { ...x } : { passport: x })).map((x, i) => ({ ...x, n: start + i }))];
    this.render();
  }
  async attributeChangedCallback() {
    const src = this.getAttribute('src'); if (!src) return;
    const list = await fetchJson(src);
    const base = new URL(src, location.href);
    this.passports = await Promise.all(list.map(async (x) => (typeof x === 'string' ? { passport: await fetchJson(new URL(x, base)), source: { url: new URL(x, base).href } }
      : typeof x?.passport === 'string' ? { ...x, passport: await fetchJson(new URL(x.passport, base)) } : x)));
  }
  async ready() {
    this.#terms ??= await loadTerms();
    for (const it of this.#items) { const id = profileIdFor(it.passport); this.#profiles[id] ??= await loadProfile(id); }
  }
  text(it) {
    if (!it._text) {
      const langs = userLangs(), t = this.#terms;
      const walk = (o) => Object.entries(o).map(([k, v]) => `${fieldLabel(k, t)} ${textOf(k, v, t, langs)} ${v && typeof v === 'object' && !Array.isArray(v) && classify(k, v, t) === 'record' ? walk(v) : ''}`).join(' ');
      it._text = walk(it.passport).toLowerCase();
    }
    return it._text;
  }
  visible() {
    const q = this.#query.trim().toLowerCase();
    if (!q) return this.#items;
    const words = q.split(/\s+/);
    return this.#items.filter((it) => words.every((w) => this.text(it).includes(w)));
  }
  async render() {
    if (!this.#items.length) return;
    await this.ready();
    const root = this.shadowRoot;
    const shown = this.visible();
    const search = el('input', { type: 'search', placeholder: 'Search passports (any words)', 'aria-label': 'Search passports', value: this.#query });
    search.addEventListener('input', () => { this.#query = search.value; this.#index = 0; this.renderBody(); this.updateCount(); });
    const modes = el('div', { role: 'group', 'aria-label': 'View' }, MODES.map(([id, label]) => el('button', {
      'aria-pressed': String(id === this.#mode), text: label, onclick: () => { this.#mode = id; this.render(); },
    })));
    this.countEl = el('span', { class: 'count', 'aria-live': 'polite' });
    this.body = el('div');
    root.replaceChildren(el('div', { class: 'bar' }, search, modes, this.countEl), this.body,
      el('dialog', {}, el('button', { class: 'close', text: 'Close', onclick: (e) => e.target.closest('dialog').close() }), el('dpp-views')));
    this.updateCount();
    await this.renderBody();
    if (document.activeElement === this && this.#query) search.focus();
  }
  updateCount() { const n = this.visible().length; this.countEl.textContent = `${n} of ${this.#items.length} passport${this.#items.length === 1 ? '' : 's'}`; }
  open(it) { const d = this.shadowRoot.querySelector('dialog'), v = d.querySelector('dpp-views'); v.source = it; v.passport = it.passport; d.showModal(); }
  async renderBody() {
    const shown = this.visible(), t = this.#terms, langs = userLangs();
    const body = this.body; body.replaceChildren();
    if (this.#mode === 'sparql') return this.renderSparql();
    if (!shown.length) { body.append(el('p', { class: 'muted', text: 'No passport matches.' })); return; }
    if (this.#mode === 'cards') {
      const grid = el('div', { class: 'cards' });
      for (const it of shown) {
        const prof = this.#profiles[profileIdFor(it.passport)], d = describe(it.passport, prof, t, langs);
        const ul = el('ul');
        for (const path of (prof.summary || []).slice(0, 4)) { const v = pathValue(it.passport, path); if (v != null) ul.append(el('li', {}, el('b', { text: fieldLabel(path.split('.').pop(), t) + ': ' }), textOf(path, v, t, langs))); }
        // a few source-only facts (e.g. energy, cells) for passports mapped from another format
        for (const k of ['Total Energy', 'Energy Storage', 'Cells per Battery', '# of Cells per Battery', 'Number of Cells Per Battery', 'Battery Cell Producer', 'Cell Manufacturer']) {
          const v = it.raw?.[k]; if (v && !/^(n\/?a|not applicable|not disclosed|no info)$/i.test(v)) ul.append(el('li', {}, el('b', { text: k + ': ' }), v));
        }
        const origin = originOf(it);
        grid.append(el('button', { class: 'card', type: 'button', onclick: () => this.open(it) },
          el('div', { class: 'badge', text: origin + (it.wave ? ' ' + it.wave : '') }),
          el('h4', { text: d.title }), el('div', { class: 'muted', text: d.subtitle }), d.maker ? el('div', { class: 'muted', text: d.maker }) : null, ul));
      }
      body.append(grid);
    } else if (this.#mode === 'carousel') {
      this.#index = Math.min(this.#index, shown.length - 1);
      const it = shown[this.#index];
      const pass = el('dpp-passport'); pass.passport = it.passport;
      const go = (d) => { this.#index = (this.#index + d + shown.length) % shown.length; this.renderBody(); };
      const prev = el('button', { text: '←', 'aria-label': 'Previous passport', onclick: () => go(-1) });
      const next = el('button', { text: '→', 'aria-label': 'Next passport', onclick: () => go(1) });
      const wrap = el('div', { class: 'carousel', tabindex: '0', 'aria-roledescription': 'carousel', onkeydown: (e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); } }, prev, pass, next);
      body.append(wrap, el('div', { class: 'dots', text: `${this.#index + 1} / ${shown.length}` }));
    } else if (this.#mode === 'compare') {
      this.renderCompare(shown);
    } else if (this.#mode === 'map') {
      this.renderMap(shown);
    }
  }
  renderCompare(shown) {
    const t = this.#terms, langs = userLangs();
    // rows: leaf paths in profile order
    const paths = [];
    const add = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && classify(k, v, t) === 'record') add(v, path);
        else if (!paths.includes(path)) paths.push(path);
      }
    };
    const prof = this.#profiles[profileIdFor(shown[0].passport)];
    for (const it of shown) add(Object.fromEntries(orderedKeys(it.passport, prof).map((k) => [k, it.passport[k]])), '');
    const toggle = el('label', {}, el('input', { type: 'checkbox', checked: this.#onlyDiff || null, onchange: (e) => { this.#onlyDiff = e.target.checked; this.renderBody(); } }), ' only rows that differ');
    const head = el('tr', {}, el('th', { text: 'Field' }), shown.map((it) => {
      const d = describe(it.passport, this.#profiles[profileIdFor(it.passport)], t, langs);
      return el('th', {}, el('button', { class: 'info', text: d.title, title: 'Open this passport', onclick: () => this.open(it) }));
    }));
    const tb = el('tbody');
    for (const path of paths) {
      const key = path.split('.').pop();
      const vals = shown.map((it) => textOf(key, pathValue(it.passport, path), t, langs));
      const differs = new Set(vals).size > 1;
      if (this.#onlyDiff && !differs) continue;
      const label = path.split('.').map((k) => fieldLabel(k, t)).join(' › ');
      // numeric rows in one unit get a bar, scaled to the largest value in the row
      const raw = shown.map((it) => pathValue(it.passport, path));
      const nums = raw.map((r) => (typeof r === 'number' ? r : r && typeof r === 'object' && typeof r.value === 'number' ? r.value : null));
      const units = new Set(raw.map((r) => (r && typeof r === 'object' ? r.unit : null)));
      const max = Math.max(...nums.filter((n) => n != null && n >= 0));
      const bars = differs && units.size === 1 && nums.every((n) => n != null && n >= 0) && max > 0;
      tb.append(el('tr', { class: differs ? 'diff' : null }, el('th', { scope: 'row', text: label }), vals.map((v, i) => el('td', {}, v || '—',
        bars ? el('span', { class: 'bar', 'aria-hidden': 'true', style: `width:${Math.max(2, Math.round((nums[i] / max) * 100))}%` }) : null))));
    }
    this.body.append(el('p', {}, toggle, el('span', { class: 'muted', text: '  Shaded rows differ between passports.' })),
      el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, head), tb)));
  }
  async renderMap(shown) {
    const t = this.#terms, langs = userLangs();
    const mapDiv = el('div', { id: 'map', role: 'region', 'aria-label': 'Map of manufacturing places' });
    const status = el('p', { class: 'muted', 'aria-live': 'polite', text: 'Loading map…' });
    this.body.append(el('link', { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css' }), mapDiv, status);
    const L = await loadLeaflet();
    const map = L.map(mapDiv).setView([50, 10], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    const points = [];
    let done = 0, approx = 0;
    for (const it of shown) {
      const place = it.passport.manufacturingPlace; if (!place) continue;
      const ll = await geocode(place);
      if (!ll) continue;
      if (ll.approx) approx++;
      points.push(ll.ll);
      const d = describe(it.passport, this.#profiles[profileIdFor(it.passport)], t, langs);
      const where = [place.manufacturingCity, place.manufacturingRegion, countryName(place.manufacturingCountry, langs)].filter(Boolean).join(', ');
      const pop = el('div', {}, el('strong', { text: d.title }), el('br'), d.subtitle, el('br'), where, ll.approx ? el('div', { text: '(country centre: city not found)' }) : null,
        el('br'), el('button', { text: 'Open passport', onclick: () => this.open(it) }));
      L.marker(ll.ll, { title: d.title, alt: d.title }).addTo(map).bindPopup(pop);
      status.textContent = `Placed ${++done} of ${shown.length}…`;
    }
    // where traced materials came from (source data such as the GBA pilots): a dot per country, joined to the factory
    const byName = new Map(Object.entries(COUNTRIES).map(([a3, [a2, lat, lon]]) => {
      let n = a3; try { n = new Intl.DisplayNames(['en'], { type: 'region' }).of(a2); } catch {}
      return [n.toLowerCase(), [lat, lon]];
    }));
    let flows = 0;
    for (const it of shown) {
      const prov = it.raw?.provenance; if (!prov?.length) continue;
      const made = it.passport.manufacturingPlace ? await geocode(it.passport.manufacturingPlace) : null;
      const d = describe(it.passport, this.#profiles[profileIdFor(it.passport)], t, langs);
      for (const pv of prov) for (const [country, share] of pv.countries || []) {
        const ll = byName.get(String(country).toLowerCase()); if (!ll) continue;
        flows++; points.push(ll);
        L.circleMarker(ll, { radius: 7, color: '#7a3e00', weight: 2, fillOpacity: 0.5 }).addTo(map)
          .bindPopup(el('div', {}, el('strong', { text: `${pv.material} from ${country}` }), el('br'), `${share} of the traced ${pv.material.toLowerCase()} for ${d.title}`, el('br'), el('button', { text: 'Open passport', onclick: () => this.open(it) })));
        if (made) L.polyline([ll, made.ll], { color: '#7a3e00', weight: 1.5, opacity: 0.6, dashArray: '4 4' }).addTo(map);
      }
    }
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 7 });
    status.textContent = `${points.length - flows} of ${shown.length} passports placed by manufacturing place${approx ? ` (${approx} at country centre)` : ''}${flows ? `; ${flows} material source${flows > 1 ? 's' : ''} (brown dots, dashed lines to the factory)` : ''}. Places found with OpenStreetMap Nominatim.`;
  }
  renderSparql() {
    const examples = SPARQL_EXAMPLES;
    const ta = el('textarea', { spellcheck: 'false', 'aria-label': 'SPARQL query' });
    ta.value = this.lastQuery || examples[0][1];
    const pick = el('select', { 'aria-label': 'Example queries', onchange: (e) => { ta.value = examples[e.target.value][1]; } },
      examples.map(([label], i) => el('option', { value: i, text: label })));
    const withChecks = el('input', { type: 'checkbox', checked: this.withChecks !== false || null, onchange: (e) => { this.withChecks = e.target.checked; } });
    const out = el('div', { 'aria-live': 'polite' });
    const run = el('button', { class: 'on', text: 'Run query', onclick: async () => {
      this.lastQuery = ta.value; run.disabled = true;
      const say = (t) => out.replaceChildren(el('p', { class: 'muted', text: t }));
      say('Loading the query engine (once) and the passports…');
      try {
        const ds = await this.dataset(this.withChecks !== false, (done, total) => say(`Checking passports against the EC rules: ${done} of ${total}…`));
        const t0 = performance.now();
        const res = await ds.query(ta.value);
        const names = new Map();
        for (const it of this.visible()) {
          const t = describe(it.passport, this.#profiles[profileIdFor(it.passport)], this.#terms).title, n = it.n + 1;
          for (const [g, what] of [['passport', ''], ['validation', ' (checks)'], ['schemaorg', ' (schema.org)'], ['source-data', ' (source data)']]) names.set(`urn:dpp:${g}:${n}`, t + what);
        }
        out.replaceChildren(renderResults(res, this.#terms, names), el('p', { class: 'muted', text: `${Array.isArray(res) ? res.length + ' rows, ' : ''}${(performance.now() - t0).toFixed(0)} ms` }));
      } catch (e) { out.replaceChildren(el('p', { text: 'Query failed: ' + e.message })); }
      finally { run.disabled = false; }
    } });
    this.body.append(el('div', { class: 'sparql' },
      el('details', {}, el('summary', { text: 'What is in the data (named graphs)' }), el('ul', {},
        el('li', {}, el('code', { text: 'urn:dpp:passport:N' }), ' each passport, as EC data'),
        el('li', {}, el('code', { text: 'urn:dpp:validation:N' }), ' its check against the EC rules: a sh:ValidationReport with sh:result entries (EC error code, field, value, explanation)'),
        el('li', {}, el('code', { text: 'urn:dpp:schemaorg:N' }), ' the same passport as schema.org, with the pending Digital Product Passport terms'),
        el('li', {}, el('code', { text: 'urn:dpp:source-data:N' }), ' the source\u2019s own fields, where the passport was mapped from another format (e.g. the GBA pilots)'),
        el('li', {}, el('code', { text: 'urn:dpp:catalog' }), ' one entry per passport: title, origin, source page, licence, verdict, and links to its graphs'),
        el('li', {}, 'default graph: the EC vocabularies and codelists (labels, definitions)'))),
      el('div', { class: 'row' }, el('label', {}, 'Example: ', pick), el('label', {}, withChecks, ' include checks (slower: about a second per passport)'), run), ta, out));
  }
  // all (currently visible) passports as RDF, partitioned into named graphs (see renderSparql)
  async dataset(withChecks = true, onProgress = () => {}) {
    const key = this.visible().map((x) => x.n).join(',') + (withChecks ? ':checks' : '');
    if (this._ds && this._dsKey === key) return this._ds;
    const F = await loadEngine();
    const { Checker, detectProfile } = await import('../lib/dpp-check.mjs');
    const base = new URL('../ec/1.0.0/', import.meta.url);
    const checker = new Checker(F, async (p) => (await fetch(new URL(p, base))).text());
    const NS = 'https://marketymarks.com/dpp/ns#', SH = 'http://www.w3.org/ns/shacl#', DCT = 'http://purl.org/dc/terms/';
    const lit = (v) => (typeof v === 'boolean' ? `"${v}"^^<http://www.w3.org/2001/XMLSchema#boolean>` : typeof v === 'number' ? `"${v}"^^<http://www.w3.org/2001/XMLSchema#decimal>` : JSON.stringify(String(v)));
    const iri = (u) => `<${String(u).replace(/[<>"{}|^`\\\s]/g, encodeURIComponent)}>`;
    const graphOf = async (ds, g, prefix) => (await ds.serialize({ format: 'ntriples' })).trim().split('\n').filter(Boolean)
      .map((l) => l.replace(/_:/g, `_:${prefix}_`).replace(/ \.\s*$/, ` <${g}> .`)).join('\n') + '\n';
    const terms = this.#terms;
    let nq = '', done = 0;
    const items = this.visible();
    for (const it of items) {
      const n = it.n + 1, gP = `urn:dpp:passport:${n}`, gV = `urn:dpp:validation:${n}`, gS = `urn:dpp:schemaorg:${n}`, gR = `urn:dpp:source-data:${n}`, C = '<urn:dpp:catalog>';
      const profile = detectProfile(it.passport);
      nq += await graphOf(await checker.toRDF(it.passport, profile), gP, `p${n}`);
      const so = toSchemaOrg(it.passport, terms, this.#profiles[profileIdFor(it.passport)], ['en']);
      nq += await graphOf(await F.jsonldToRdf(JSON.stringify({ ...so, '@context': OFFLINE_CONTEXT })), gS, `s${n}`);
      const origin = originOf(it);
      const title = describe(it.passport, this.#profiles[profileIdFor(it.passport)], terms).title;
      const cat = [[`<${gP}>`, `<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>`, `<http://www.w3.org/ns/dcat#Dataset>`],
        [`<${gP}>`, `<${DCT}title>`, lit(title)], [`<${gP}>`, `<${NS}origin>`, lit(origin)], [`<${gP}>`, `<${NS}schemaorgView>`, `<${gS}>`]];
      if (it.source?.url) cat.push([`<${gP}>`, `<${DCT}source>`, iri(it.source.url)]);
      if (it.source?.retrieved) cat.push([`<${gP}>`, `<${NS}retrieved>`, `"${it.source.retrieved}"^^<http://www.w3.org/2001/XMLSchema#date>`]);
      cat.push([`<${gP}>`, `<${DCT}license>`, it.source?.licence ? iri(it.source.licence) : lit(origin === 'EC sample' ? 'EUPL-1.2' : origin === 'fictional demo' ? 'fictional data' : 'none stated')]);
      if (it.wave) cat.push([`<${gP}>`, `<${NS}pilotWave>`, lit(it.wave)]);
      if (it.raw) {
        cat.push([`<${gP}>`, `<${NS}sourceData>`, `<${gR}>`]);
        let k = 0;
        for (const [name, value] of Object.entries(it.raw)) {
          if (value == null || typeof value === 'object') continue;
          const b = `_:r${n}_${k++}`;
          nq += `<${gP}> <${NS}sourceField> ${b} <${gR}> .\n${b} <${NS}name> ${lit(name)} <${gR}> .\n${b} <${NS}value> ${lit(value)} <${gR}> .\n`;
        }
        for (const pv of it.raw.provenance || []) {
          const b = `_:r${n}_${k++}`;
          nq += `<${gP}> <${NS}materialProvenance> ${b} <${gR}> .\n${b} <${NS}material> ${lit(pv.material)} <${gR}> .\n`;
          if (pv.supplyChainMapped) nq += `${b} <${NS}supplyChainMapped> ${lit(pv.supplyChainMapped)} <${gR}> .\n`;
          for (const [country, share] of pv.countries || []) { const c = `_:r${n}_${k++}`; nq += `${b} <${NS}sourcedFrom> ${c} <${gR}> .\n${c} <${NS}country> ${lit(country)} <${gR}> .\n${c} <${NS}share> ${lit(share)} <${gR}> .\n`; }
        }
      }
      if (withChecks) {
        const view = it.view || 'pub';
        const r = await checker.check(it.passport, { view, profile });
        const rep = `<${gV}#report>`;
        nq += `${rep} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${SH}ValidationReport> <${gV}> .\n${rep} <${SH}conforms> ${lit(r.verdict === 'passes')} <${gV}> .\n`;
        nq += `${rep} <${NS}verdict> ${lit(r.verdict)} <${gV}> .\n${rep} <${NS}view> ${lit(view)} <${gV}> .\n${rep} <${NS}checked> <${gP}> <${gV}> .\n`;
        r.problems.forEach((pr, k) => {
          const b = `_:v${n}_${k}`;
          nq += `${rep} <${SH}result> ${b} <${gV}> .\n${b} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${SH}ValidationResult> <${gV}> .\n`;
          if (pr.code) nq += `${b} <${SH}resultMessage> ${lit(pr.code)} <${gV}> .\n`;
          if (pr.field) nq += `${b} <${SH}resultPath> ${terms.fields[pr.field]?.iri ? `<${terms.fields[pr.field].iri}>` : lit(pr.field)} <${gV}> .\n${b} <${NS}field> ${lit(pr.field)} <${gV}> .\n`;
          if (pr.value != null) nq += `${b} <${SH}value> ${lit(pr.value)} <${gV}> .\n`;
          if (pr.explanation) nq += `${b} <${NS}explanation> ${lit(pr.explanation)} <${gV}> .\n`;
          if (pr.rule) nq += `${b} <${NS}rule> ${lit(pr.rule)} <${gV}> .\n`;
        });
        cat.push([`<${gP}>`, `<${NS}validation>`, `<${gV}>`], [`<${gP}>`, `<${NS}verdict>`, lit(r.verdict)], [`<${gP}>`, `<${NS}problemCount>`, lit(r.problems.length)]);
        onProgress(++done, items.length);
      }
      nq += cat.map((t) => `${t.join(' ')} ${C} .`).join('\n') + '\n';
    }
    const ds = await F.datasetMerge(await F.parse(nq, 'nquads'), await checker.vocabularies());
    this._ds = ds; this._dsKey = key;
    return ds;
  }
}

const SPARQL_EXAMPLES = [
  ['Passports with category and chemistry', `PREFIX bat: <https://repository.product-passport.ec.europa.eu/product/batteries/vocabs/battery-vocabulary#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?passport ?category ?chemistry WHERE {
  GRAPH ?passport { ?b bat:batteryCategory ?c . OPTIONAL { ?b bat:batteryChemistry ?ch } }
  ?c skos:prefLabel ?category .
  OPTIONAL { ?ch skos:prefLabel ?chemistry }
} ORDER BY ?passport`],
  ['Capacity (Ah), heaviest first', `PREFIX bat: <https://repository.product-passport.ec.europa.eu/product/batteries/vocabs/battery-vocabulary#>
PREFIX dppcom: <https://repository.product-passport.ec.europa.eu/core/vocabs/common-vocabulary#>
SELECT ?passport ?model ?capacity ?weight WHERE {
  GRAPH ?passport {
    ?b bat:batteryCapacity [ dppcom:value ?capacity ] ; bat:batteryWeight [ dppcom:value ?weight ] .
    OPTIONAL { ?b bat:batteryIdentification [ bat:modelIdentifier ?model ] }
  }
} ORDER BY DESC(?weight)`],
  ['Count by manufacturing country', `PREFIX bat: <https://repository.product-passport.ec.europa.eu/product/batteries/vocabs/battery-vocabulary#>
SELECT ?country (COUNT(DISTINCT ?passport) AS ?passports) WHERE {
  GRAPH ?passport { ?b bat:manufacturingPlace [ bat:manufacturingCountry ?country ] }
} GROUP BY ?country ORDER BY DESC(?passports)`],
  ['Critical raw materials used', `PREFIX bat: <https://repository.product-passport.ec.europa.eu/product/batteries/vocabs/battery-vocabulary#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?material (COUNT(DISTINCT ?passport) AS ?passports) WHERE {
  GRAPH ?passport { ?b bat:criticalRawMaterials ?m }
  ?m skos:prefLabel ?material .
} GROUP BY ?material ORDER BY DESC(?passports)`],
  ['Catalogue: every passport, where it came from, verdict', `PREFIX dct: <http://purl.org/dc/terms/>
PREFIX m: <https://marketymarks.com/dpp/ns#>
SELECT ?passport ?origin ?verdict ?problems ?source WHERE {
  GRAPH <urn:dpp:catalog> { ?passport m:origin ?origin . OPTIONAL { ?passport m:verdict ?verdict ; m:problemCount ?problems } OPTIONAL { ?passport dct:source ?source } }
} ORDER BY ?origin ?passport`],
  ['Most common problems across all passports', `PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX m: <https://marketymarks.com/dpp/ns#>
SELECT ?code ?field (COUNT(DISTINCT ?report) AS ?passports) (SAMPLE(?why) AS ?explanation) WHERE {
  GRAPH ?g { ?report a sh:ValidationReport ; sh:result ?r . ?r sh:resultMessage ?code . OPTIONAL { ?r m:field ?field } OPTIONAL { ?r m:explanation ?why } }
} GROUP BY ?code ?field ORDER BY DESC(?passports) LIMIT 40`],
  ['Real pilots (GBA): what is missing for the EC format', `PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX m: <https://marketymarks.com/dpp/ns#>
SELECT ?field (COUNT(DISTINCT ?passport) AS ?pilots) WHERE {
  GRAPH <urn:dpp:catalog> { ?passport m:origin "GBA pilot" ; m:validation ?v }
  GRAPH ?v { ?report sh:result ?r . ?r m:field ?field }
} GROUP BY ?field ORDER BY DESC(?pilots)`],
  ['Real pilots (GBA): source fields, e.g. energy and cells', `PREFIX m: <https://marketymarks.com/dpp/ns#>
SELECT ?passport ?name ?value WHERE {
  GRAPH ?g { ?passport m:sourceField [ m:name ?name ; m:value ?value ] }
  FILTER(REGEX(?name, "Energy|Cells|Recycled|Traceability|Country", "i"))
} ORDER BY ?passport ?name`],
  ['Real pilots (GBA): where traced materials came from', `PREFIX m: <https://marketymarks.com/dpp/ns#>
SELECT ?passport ?material ?country ?share WHERE {
  GRAPH ?g { ?passport m:materialProvenance ?p . ?p m:material ?material . ?p m:sourcedFrom [ m:country ?country ; m:share ?share ] }
} ORDER BY ?material ?country`],
  ['schema.org view: products with weight and origin', `PREFIX schema: <https://schema.org/>
SELECT ?product ?name ?weight ?unit ?country WHERE {
  GRAPH ?g { ?product a schema:Product ; schema:name ?name .
    OPTIONAL { ?product schema:weight [ schema:value ?weight ; schema:unitCode ?unit ] }
    OPTIONAL { ?product schema:countryOfOrigin [ schema:name ?country ] } }
} ORDER BY DESC(?weight)`],
  ['schema.org view: pending DPP terms in use', `PREFIX schema: <https://schema.org/>
SELECT ?term (COUNT(*) AS ?uses) WHERE {
  GRAPH ?g { ?s ?p ?o }
  VALUES ?term { schema:hasDigitalProductPassport schema:substanceOfConcern schema:recycledContentPercentage schema:DeclarationOfConformity schema:DigitalProductPassport }
  FILTER(?p = ?term || ?o = ?term)
} GROUP BY ?term`],
  ['Text search in multilingual fields', `PREFIX bat: <https://repository.product-passport.ec.europa.eu/product/batteries/vocabs/battery-vocabulary#>
SELECT ?passport ?field ?text WHERE {
  GRAPH ?passport { ?s ?field ?text FILTER(isLiteral(?text) && lang(?text) != "" && CONTAINS(LCASE(STR(?text)), "water")) }
}`],
];

const NUMERIC = /#(double|float|decimal|integer|int|long|short|nonNegativeInteger|positiveInteger)$/;
function renderResults(res, terms, names = new Map()) {
  if (typeof res === 'boolean') return el('p', { text: res ? 'Yes (true)' : 'No (false)' });
  if (!Array.isArray(res)) return el('pre', { text: String(res) });
  if (!res.length) return el('p', { class: 'muted', text: 'No results.' });
  const vars = [...res[0].keys()];
  const show = (term) => {
    if (!term) return '';
    if (term.termType === 'NamedNode') return names.get(term.value) || (terms.codes[term.value] ? terms.codes[term.value].label : shortIri(term.value));
    if (term.datatype && NUMERIC.test(term.datatype.value || term.datatype)) { const n = Number(term.value); if (Number.isFinite(n)) return new Intl.NumberFormat(userLangs(), { maximumFractionDigits: 6 }).format(n); }
    if (/^[A-Z]{3}$/.test(term.value) && COUNTRIES[term.value]) return `${countryName(term.value)} (${term.value})`;
    return term.value + (term.language && !/^en\b/i.test(term.language) ? ` @${term.language}` : '');
  };
  return el('div', { class: 'tablewrap' }, el('table', {},
    el('thead', {}, el('tr', {}, vars.map((v) => el('th', { text: v })))),
    el('tbody', {}, res.map((r) => el('tr', {}, vars.map((v) => el('td', { text: show(r.get(v)) })))))));
}

// ---- maps --------------------------------------------------------------------------
let leafletPromise;
function loadLeaflet() {
  return (leafletPromise ??= new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => {
      // Leaflet finds its marker images via its stylesheet, which it can't see inside shadow DOM
      window.L.Icon.Default.imagePath = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/';
      resolve(window.L);
    }; s.onerror = () => reject(new Error('map library did not load'));
    document.head.append(s);
  }));
}
// manufacturing place -> {ll:[lat,lon], approx}. Cached; at most one Nominatim request per second.
let lastGeo = 0;
async function geocode(place) {
  const country = COUNTRIES[String(place.manufacturingCountry || '').toUpperCase()];
  const key = 'dpp-geo:' + [place.manufacturingCity, place.manufacturingRegion, place.manufacturingCountry].join('|');
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch {}
  let result = null;
  if (place.manufacturingCity) {
    const wait = lastGeo + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeo = Date.now();
    const q = new URLSearchParams({ format: 'jsonv2', limit: '1', city: place.manufacturingCity });
    if (country) q.set('countrycodes', country[0].toLowerCase());
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + q, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (j[0]) result = { ll: [Number(j[0].lat), Number(j[0].lon)], approx: false };
    } catch {}
  }
  if (!result && country) result = { ll: [country[1], country[2]], approx: true };
  if (result) try { localStorage.setItem(key, JSON.stringify(result)); } catch {}
  return result;
}

// ---- <dpp-crosswalk>: every EC battery field and its counterparts elsewhere -----------------
class DppCrosswalk extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); styles(this.shadowRoot, COLL_CSS); }
  async connectedCallback() {
    const [terms, xw] = await Promise.all([loadTerms(), loadCrosswalk()]);
    if (!xw) { this.shadowRoot.replaceChildren(el('p', { text: 'Crosswalk not available.' })); return; }
    const targets = Object.entries(xw.targets);
    const q = el('input', { type: 'search', placeholder: 'Filter fields (any words)', 'aria-label': 'Filter fields' });
    const only = el('select', { 'aria-label': 'Match filter' }, ['all matches', 'exact only', 'no counterpart somewhere'].map((t, i) => el('option', { value: i, text: t })));
    const tb = el('tbody'), count = el('span', { class: 'count', 'aria-live': 'polite' });
    const rows = Object.keys(xw.fields).concat(Object.keys(terms.fields).filter((k) => !(k in xw.fields) && terms.fields[k].iri.includes('battery-vocabulary')))
      .map((k) => ({ k, label: fieldLabel(k, terms), m: xw.fields[k] || {} }));
    const draw = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = rows.filter((r) => {
        const text = [r.k, r.label, ...Object.values(r.m).flat().map((m) => m.path + ' ' + (m.note || ''))].join(' ').toLowerCase();
        if (!words.every((w) => text.includes(w))) return false;
        if (only.value === '1') return Object.values(r.m).flat().some((m) => m.match === 'exact');
        if (only.value === '2') return targets.some(([t]) => !(r.m[t] || []).length);
        return true;
      });
      tb.replaceChildren(...shown.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.label, el('div', {}, el('code', { class: 'muted', text: r.k }))),
        targets.map(([t]) => el('td', {}, (r.m[t] || []).length ? (r.m[t]).map((m) => el('div', {}, el('code', { text: m.path }),
          el('div', { class: 'muted', text: m.match + (m.note ? ' — ' + m.note : '') }))) : el('span', { class: 'muted', text: '—' }))))));
      count.textContent = `${shown.length} of ${rows.length} fields`;
    };
    q.addEventListener('input', draw); only.addEventListener('change', draw);
    this.shadowRoot.replaceChildren(el('div', { class: 'bar' }, q, only, count),
      el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'EC field' }),
        targets.map(([, v]) => el('th', {}, el('a', { href: v.url, rel: 'noopener', target: '_blank', text: `${v.label} ${v.version}` }), el('div', { class: 'muted', text: v.licence || '' }))))), tb)));
    draw();
  }
}

customElements.define('dpp-passport', DppPassport);
customElements.define('dpp-structured', DppStructured);
customElements.define('dpp-views', DppViews);
customElements.define('dpp-collection', DppCollection);
customElements.define('dpp-crosswalk', DppCrosswalk);
