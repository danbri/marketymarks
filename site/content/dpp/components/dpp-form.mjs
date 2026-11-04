// <dpp-form sub="evb|ind|lmt" view="pub|res1|res2|res3|all">: an entry form generated from the
// EC SHACL shapes (via the shape trees in shapes/), so what it asks for is what the EC rules
// require. Fields are grouped by the presentation profile; required ones are marked. It keeps a
// passport object in EC JSON, shows it live, and can check it with the EC rules and download it.
// .passport sets or reads the current passport (e.g. to start from an existing one).

import { loadTerms, loadProfile, fieldLabel, codeOf, fieldOf, EC } from './dpp-model.mjs';
import { loadEngine } from './engine.mjs';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const V = new URL(import.meta.url).search;
const CSS = `
:host { --bg: var(--dpp-bg, #fff); --ink: var(--dpp-ink, #111); --muted: var(--dpp-muted, #555); --line: var(--dpp-line, #ddd);
  --edge: var(--dpp-edge, #767676); --soft: var(--dpp-soft, #fafafa); --bad: #a3200f; --ok: #075a32;
  display: block; color: var(--ink); font: var(--dpp-font, 15px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace); }
@media (prefers-color-scheme: dark) { :host { --bg: var(--dpp-bg, #111); --ink: var(--dpp-ink, #e8e8e8); --muted: var(--dpp-muted, #b3b3b3);
  --line: var(--dpp-line, #333); --edge: var(--dpp-edge, #8a8a8a); --soft: var(--dpp-soft, #1a1a1a); --bad: #ff8a7a; --ok: #6fd3a0; } }
* { box-sizing: border-box; }
fieldset { border: 1px solid var(--line); margin: 0 0 1rem; padding: .6rem .8rem; }
fieldset fieldset { margin: .4rem 0; }
legend { font-weight: 700; padding: 0 .3rem; }
.f { display: grid; grid-template-columns: minmax(10rem, 17rem) 1fr; gap: .3rem 1rem; align-items: start; margin: .35rem 0; }
.f > label { color: var(--muted); padding-top: .25rem; }
.req::after { content: " *"; color: var(--bad); }
input, select, textarea, button { font: inherit; color: var(--ink); }
input, select, textarea { background: var(--bg); border: 1px solid var(--edge); padding: 3px 6px; width: 100%; }
input[type=checkbox] { width: auto; }
select[multiple] { min-height: 6rem; }
button { background: var(--bg); border: 1px solid var(--ink); padding: 3px 10px; cursor: pointer; width: auto; }
button.primary { background: var(--ink); color: var(--bg); }
.row { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
.row input { flex: 1 1 8rem; width: auto; }
.lang input:first-child { flex: 0 0 6.5rem; }
.hint { color: var(--muted); font-size: .85em; }
.bar { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; margin: .8rem 0; }
pre { background: var(--soft); padding: .6rem; overflow: auto; font-size: 12px; max-height: 50vh; }
.ok { color: var(--ok); font-weight: 700; } .bad { color: var(--bad); font-weight: 700; }
ul.problems { margin: .4rem 0 0 1.1rem; padding: 0; }
@media (max-width: 600px) { .f { grid-template-columns: 1fr; } }
`;
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
let uid = 0;
const SUB_IDS = { evb: 'subgroup/evb', ind: 'subgroup/ind', lmt: 'subgroup/lmt' };

class DppForm extends HTMLElement {
  static observedAttributes = ['sub', 'view'];
  #passport = {}; #tree = null; #terms = null; #profile = null;
  constructor() { super(); this.attachShadow({ mode: 'open' }); const st = document.createElement('style'); st.textContent = CSS; this.shadowRoot.append(st); this.body = el('div'); this.shadowRoot.append(this.body); }
  get passport() { return structuredClone(this.#passport); }
  set passport(p) { this.#passport = structuredClone(p || {}); this.render(); }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  async render() {
    const sub = this.getAttribute('sub') || 'evb', view = this.getAttribute('view') || 'pub';
    const base = new URL('./', import.meta.url);
    [this.#terms, this.#profile, this.#tree] = await Promise.all([loadTerms(), loadProfile('batteries'),
      fetch(new URL(`shapes/ec-1.0.0-${view}-${sub}.json${V}`, base)).then((r) => r.json())]);
    // the content specification identifiers are fixed by the rule set
    this.#passport.contentSpecificationIds = [`${EC}product/batteries/1.0.0`, `${EC}core/1.0.0`, `${EC}product/batteries/${SUB_IDS[sub]}/1.0.0`];
    const props = this.#tree.root.props;
    const used = new Set(['contentSpecificationIds']);
    const groups = [];
    for (const g of this.#profile.groups) {
      const keys = g.fields.filter((k) => k in props && !used.has(k)); keys.forEach((k) => used.add(k));
      if (keys.length) groups.push(el('fieldset', {}, el('legend', { text: g.title }), keys.map((k) => this.field(props[k], k, this.#passport))));
    }
    const rest = Object.keys(props).filter((k) => !used.has(k));
    if (rest.length) groups.push(el('fieldset', {}, el('legend', { text: 'Other fields' }), rest.map((k) => this.field(props[k], k, this.#passport))));
    this.preview = el('pre', { 'aria-label': 'Passport JSON' });
    this.result = el('div', { 'aria-live': 'polite' });
    this.body.replaceChildren(el('p', { class: 'hint', text: `Fields marked * are required by the EC rules for this passport type and view. Content specification: batteries / ${sub} (1.0.0).` }),
      ...groups,
      el('div', { class: 'bar' }, el('button', { class: 'primary', type: 'button', text: 'Check with the EC rules', onclick: () => this.check() }),
        el('button', { type: 'button', text: 'Download JSON', onclick: () => this.download() })),
      this.result, el('details', {}, el('summary', { text: 'Passport JSON (live)' }), this.preview));
    this.update();
  }
  update() { this.preview.textContent = JSON.stringify(prune(this.#passport), null, 2); this.dispatchEvent(new CustomEvent('change', { detail: this.passport })); }
  // a form control for one property shape, writing into obj[key]
  field(p, key, obj) {
    const t = this.#terms, idc = `f${++uid}`;
    const label = el('label', { for: idc, class: p.min > 0 || p.qualified?.some((q) => q.min > 0) ? 'req' : null, title: fieldOf(t, key)?.definition || '' }, fieldLabel(key, t));
    const set = (v) => { if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete obj[key]; else obj[key] = v; this.update(); };
    const many = p.max == null || p.max > 1;
    const options = [...p.values, ...p.codelists.flatMap((s) => Object.entries(t.codes).filter(([, c]) => c.scheme && s.endsWith('/' + c.scheme)).map(([iri]) => iri))];
    let control;
    if (p.langMap || p.datatypes.includes('http://www.w3.org/1999/02/22-rdf-syntax-ns#langString')) control = this.langMap(p, key, obj, idc);
    else if (options.length && options.every((o) => typeof o === 'boolean')) {
      control = el('input', { id: idc, type: 'checkbox', checked: obj[key] === true || null, onchange: (e) => set(e.target.checked ? true : undefined) });
    } else if (options.length) {
      const cur = [].concat(obj[key] ?? []);
      control = el('select', { id: idc, multiple: many || null, onchange: (e) => { const v = [...e.target.selectedOptions].map((o) => o.value).filter(Boolean); set(many ? v : v[0]); } },
        many ? null : el('option', { value: '', text: '— choose —' }),
        [...new Set(options)].map((o) => el('option', { value: o, selected: cur.includes(o) || null, text: codeOf(t, o)?.label || String(o).replace(/.*[#/]/, '') })));
    } else if (p.node) {
      const vals = p.node.props;
      if ('unit' in vals && 'value' in vals && Object.keys(vals).length <= 3) return this.quantity(p, key, obj, label, idc);
      obj[key] ??= undefined;
      const inner = obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) ? obj[key] : {};
      const box = el('fieldset', {}, el('legend', { class: label.className, text: fieldLabel(key, t) }),
        Object.entries(vals).map(([k, q]) => this.field(q, k, new Proxy(inner, { set: (o, kk, v) => { o[kk] = v; obj[key] = inner; return true; },
          deleteProperty: (o, kk) => { delete o[kk]; if (!Object.keys(o).length) delete obj[key]; else obj[key] = inner; return true; } }))));
      return box;
    } else {
      const dt = p.datatypes[0] || '';
      const type = dt === XSD + 'gYearMonth' ? 'month' : dt === XSD + 'dateTime' ? 'datetime-local' : dt === XSD + 'date' ? 'date' : /integer|decimal|double|float|Integer/.test(dt) ? 'number' : dt === XSD + 'anyURI' ? 'url' : 'text';
      const toVal = (s) => (s === '' ? undefined : type === 'number' ? Number(s) : type === 'datetime-local' ? new Date(s).toISOString().replace(/\.\d+Z$/, 'Z') : s);
      const fromVal = (v) => (v == null ? '' : type === 'datetime-local' ? String(v).slice(0, 16) : String(v));
      control = el('input', { id: idc, type, step: type === 'number' && /integer|Integer/.test(dt) ? '1' : type === 'number' ? 'any' : null,
        value: fromVal(Array.isArray(obj[key]) ? obj[key][0] : obj[key]), pattern: p.patterns[0] || null,
        oninput: (e) => { const v = toVal(e.target.value); set(many && v !== undefined ? [v] : v); } });
    }
    return el('div', { class: 'f' }, label, control);
  }
  quantity(p, key, obj, label, idc) {
    const units = [...(p.node.props.unit.values || [])];
    const cur = obj[key] || {};
    const num = el('input', { id: idc, type: 'number', step: 'any', value: cur.value ?? '', 'aria-label': fieldLabel(key, this.#terms) + ' value' });
    const unit = el('select', { 'aria-label': 'unit' }, units.map((u) => el('option', { value: u, selected: cur.unit === u || null, text: codeOf(this.#terms, u)?.symbol || u.replace(/.*#/, '') })));
    const upd = () => { if (num.value === '') delete obj[key]; else obj[key] = { unit: unit.value, value: Number(num.value) }; this.update(); };
    num.addEventListener('input', upd); unit.addEventListener('change', upd);
    return el('div', { class: 'f' }, label, el('div', { class: 'row' }, num, unit));
  }
  langMap(p, key, obj, idc) {
    const wrap = el('div');
    const rows = () => {
      const m = obj[key] && typeof obj[key] === 'object' ? obj[key] : {};
      const entries = Object.entries(m).length ? Object.entries(m) : [['en-GB', '']];
      wrap.replaceChildren(...entries.map(([lang, text], i) => {
        const l = el('input', { value: lang, 'aria-label': 'language (e.g. en-GB)', pattern: '[A-Za-z]{2}-[A-Za-z]{2}', size: 6 });
        const tx = el('input', { id: i === 0 ? idc : null, value: text, 'aria-label': 'text' });
        const save = () => {
          const out = {};
          for (const r of wrap.querySelectorAll('.lang')) { const [a, b] = r.querySelectorAll('input'); if (a.value && b.value) out[a.value] = b.value; }
          if (Object.keys(out).length) obj[key] = out; else delete obj[key];
          this.update();
        };
        l.addEventListener('input', save); tx.addEventListener('input', save);
        return el('div', { class: 'row lang' }, l, tx);
      }), (p.max == null || p.max > 1) ? el('button', { type: 'button', text: '+ language', onclick: () => { const m2 = { ...(obj[key] || {}) }; m2['xx-XX'] = ''; obj[key] = m2; rows(); } }) : null);
    };
    rows();
    return wrap;
  }
  async check() {
    this.result.replaceChildren(el('p', { class: 'hint', text: 'Checking (loading the engine the first time, about 31 MB)…' }));
    const F = await loadEngine();
    const { Checker } = await import(new URL(`../lib/dpp-check.mjs${V}`, import.meta.url).href);
    const base = new URL('../ec/1.0.0/', import.meta.url);
    this.checker ??= new Checker(F, async (p) => (await fetch(new URL(p, base))).text());
    const r = await this.checker.check(prune(this.#passport), { view: this.getAttribute('view') || 'pub' });
    const verdict = el('p', { class: r.verdict === 'passes' ? 'ok' : 'bad', text: r.verdict === 'passes' ? 'Passes the EC rules.' : `Not yet: ${r.problems.length} problem(s).` });
    const list = el('ul', { class: 'problems' }, r.problems.slice(0, 40).map((x) => el('li', {}, `${x.field ? fieldLabel(x.field, this.#terms) + ': ' : ''}${x.explanation || x.code}`)));
    this.result.replaceChildren(...(r.problems.length ? [verdict, list] : [verdict]));
  }
  download() {
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(prune(this.#passport), null, 2)], { type: 'application/json' })), download: 'passport.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
// drop empty values left by the form
function prune(v) {
  if (Array.isArray(v)) { const a = v.map(prune).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { const y = prune(x); if (y !== undefined) o[k] = y; } return Object.keys(o).length ? o : undefined; }
  return v === '' || v == null ? undefined : v;
}
customElements.define('dpp-form', DppForm);
