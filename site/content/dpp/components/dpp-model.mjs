// dpp-model: understands EC DPP JSON well enough to present it to people.
// Labels, definitions, units and access levels come from the EC vocabularies
// (built into ec-1.0.0-terms.json); grouping comes from a presentation profile.
// No RDF engine is needed here.

const HERE = new URL('./', import.meta.url);
// carry this module's ?v= build id onto the JSON it fetches, so caches stay consistent
const V = new URL(import.meta.url).search;
export const EC = 'https://repository.product-passport.ec.europa.eu/';

let termsPromise, profiles = new Map();
export function loadTerms(url = new URL('ec-1.0.0-terms.json' + V, HERE)) {
  return (termsPromise ??= fetch(url).then((r) => r.json()));
}
export function loadProfile(id) {
  if (!profiles.has(id)) profiles.set(id, fetch(new URL(`profiles/${id}.json${V}`, HERE))
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    // no profile for this product group yet: show every field in one plain group
    .then((p) => p || { id, title: ['uniqueProductIdentifier', 'digitalProductPassportId'], subtitle: [], summary: [], groups: [] }));
  return profiles.get(id);
}
let crosswalkPromise;
// what each EC field is called in other DPP / battery models (Catena-X, Battery Pass, UNTP)
export function loadCrosswalk() {
  return (crosswalkPromise ??= fetch(new URL('crosswalk/batteries.json' + V, HERE)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}
export function profileIdFor(passport) {
  const ids = passport?.contentSpecificationIds || [];
  return ids.some((x) => String(x).startsWith(EC + 'product/batteries/')) ? 'batteries' : 'core';
}
export function subgroupOf(passport) {
  const ids = passport?.contentSpecificationIds || [];
  return ['evb', 'ind', 'lmt'].find((s) => ids.some((x) => String(x).includes(`/subgroup/${s}/`))) || null;
}

// Look up a key in the vocabulary tables as an own property only: a JSON key such as
// "constructor" or "__proto__" must not match Object.prototype (found by the Lean model).
export const fieldOf = (terms, key) => (terms && Object.hasOwn(terms.fields, key) ? terms.fields[key] : undefined);
export const codeOf = (terms, iri) => (terms && typeof iri === 'string' && Object.hasOwn(terms.codes, iri) ? terms.codes[iri] : undefined);

// --- languages -------------------------------------------------------------
const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
// keep only valid BCP 47 tags (a POSIX locale such as "C" or "C.UTF-8" would make Intl throw); English as the fallback
export function cleanLangs(langs) {
  const out = [];
  for (const l of [].concat(langs || [])) {
    const tag = String(l).split('.')[0].replace('_', '-');
    try { if (tag && tag !== 'C' && tag !== 'POSIX') out.push(...Intl.getCanonicalLocales(tag)); } catch {}
  }
  return out.length ? out : ['en'];
}
export const userLangs = () => (typeof navigator !== 'undefined' && navigator.languages?.length ? navigator.languages : ['en']).map((l) => l.toLowerCase());
export function isLangMap(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 &&
    Object.entries(v).every(([k, x]) => LANG_TAG.test(k) && typeof x === 'string');
}
// best text for the reader's languages: exact tag, then same language, then English, then first
export function pickLang(map, langs = userLangs()) {
  const keys = Object.keys(map), low = keys.map((k) => k.toLowerCase());
  for (const l of langs) { const i = low.indexOf(l); if (i >= 0) return { lang: keys[i], text: map[keys[i]] }; }
  for (const l of langs) { const i = low.findIndex((k) => k.split('-')[0] === l.split('-')[0]); if (i >= 0) return { lang: keys[i], text: map[keys[i]] }; }
  const en = low.findIndex((k) => k.startsWith('en'));
  const i = en >= 0 ? en : 0;
  return { lang: keys[i], text: map[keys[i]] };
}

// --- countries (ISO 3166-1 alpha-3, as the EC model uses) ---------------------
// alpha-3 -> [alpha-2, lat, lon] (approximate centre, for maps without a city match)
export const COUNTRIES = {
  AUT: ['AT', 47.6, 14.1], BEL: ['BE', 50.6, 4.6], BGR: ['BG', 42.7, 25.3], HRV: ['HR', 45.1, 15.2], CYP: ['CY', 35.0, 33.2],
  CZE: ['CZ', 49.8, 15.5], DNK: ['DK', 56.0, 10.0], EST: ['EE', 58.7, 25.5], FIN: ['FI', 64.5, 26.0], FRA: ['FR', 46.6, 2.4],
  DEU: ['DE', 51.1, 10.4], GRC: ['GR', 39.1, 22.0], HUN: ['HU', 47.2, 19.4], IRL: ['IE', 53.2, -8.0], ITA: ['IT', 42.8, 12.6],
  LVA: ['LV', 56.9, 24.6], LTU: ['LT', 55.3, 23.9], LUX: ['LU', 49.8, 6.1], MLT: ['MT', 35.9, 14.4], NLD: ['NL', 52.2, 5.5],
  POL: ['PL', 52.1, 19.4], PRT: ['PT', 39.6, -8.0], ROU: ['RO', 45.9, 24.9], SVK: ['SK', 48.7, 19.7], SVN: ['SI', 46.1, 14.8],
  ESP: ['ES', 40.2, -3.6], SWE: ['SE', 62.0, 15.0], NOR: ['NO', 61.4, 8.8], ISL: ['IS', 64.9, -18.6], CHE: ['CH', 46.8, 8.2],
  GBR: ['GB', 54.0, -2.5], TUR: ['TR', 39.0, 35.2], SRB: ['RS', 44.0, 20.9], UKR: ['UA', 49.0, 31.4], MAR: ['MA', 31.8, -7.1],
  USA: ['US', 39.8, -98.6], CAN: ['CA', 56.1, -106.3], MEX: ['MX', 23.6, -102.6], BRA: ['BR', -14.2, -51.9], CHL: ['CL', -35.7, -71.5],
  ARG: ['AR', -38.4, -63.6], CHN: ['CN', 35.9, 104.2], JPN: ['JP', 36.2, 138.3], KOR: ['KR', 35.9, 127.8], TWN: ['TW', 23.7, 121.0],
  IND: ['IN', 20.6, 79.0], IDN: ['ID', -0.8, 113.9], VNM: ['VN', 14.1, 108.3], THA: ['TH', 15.9, 100.9], MYS: ['MY', 4.2, 102.0],
  AUS: ['AU', -25.3, 133.8], ZAF: ['ZA', -30.6, 22.9], COD: ['CD', -4.0, 21.8], ZMB: ['ZM', -13.1, 27.8], ISR: ['IL', 31.0, 34.9],
};
export function countryName(alpha3, langs = userLangs()) {
  const c = COUNTRIES[String(alpha3).toUpperCase()];
  if (!c) return alpha3;
  try { return new Intl.DisplayNames(cleanLangs(langs), { type: 'region' }).of(c[0]) || alpha3; } catch { return alpha3; }
}

// --- value classification ------------------------------------------------------
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-\d{2}$/;

// kind: code | quantity | range | langtext | document | record | list | boolean | number | date | link | country | text | empty
export function classify(key, v, terms) {
  if (v === null || v === undefined || v === '') return 'empty';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') {
    if (codeOf(terms, v)) return 'code';
    if (/Country$/.test(key) && /^[A-Z]{3}$/.test(v)) return 'country';
    if (DATE_TIME.test(v) || DATE.test(v) || YEAR_MONTH.test(v)) return 'date';
    if (/^(https?:|mailto:)/.test(v)) return 'link';
    return 'text';
  }
  if (isLangMap(v)) return 'langtext';
  if ('value' in v && 'unit' in v) return 'quantity';
  if ('lowerBound' in v || 'upperBound' in v) return 'range';
  if ('url' in v && ('resourceTitle' in v || 'contentType' in v)) return 'document';
  return 'record';
}

const numberFmt = (n, langs) => { try { return new Intl.NumberFormat(cleanLangs(langs), { maximumFractionDigits: 6 }).format(n); } catch { return String(n); } };
export function unitSymbol(iri, terms) {
  const c = codeOf(terms, iri);
  return c ? (c.symbol || c.label) : String(iri).replace(/.*[#/]/, '');
}
export function codeLabel(iri, terms) {
  const c = codeOf(terms, iri);
  return c ? c.label : String(iri).replace(/.*[#/]/, '');
}
export function formatDate(v, langs = userLangs()) {
  langs = cleanLangs(langs);
  try {
    if (YEAR_MONTH.test(v)) return new Intl.DateTimeFormat(langs, { year: 'numeric', month: 'long' }).format(new Date(v + '-01T00:00:00Z'));
    if (DATE.test(v)) return new Intl.DateTimeFormat(langs, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(v + 'T00:00:00Z'));
    return new Intl.DateTimeFormat(langs, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(v)) + ' UTC';
  } catch { return v; }
}
export function formatQuantity(q, terms, langs = userLangs()) {
  const sym = unitSymbol(q.unit, terms);
  const sep = sym === '%' ? '' : ' ';
  let s = `${numberFmt(q.value, langs)}${sep}${sym}`;
  if (q.valueRange) s += ` (${formatRange(q.valueRange, terms, langs)})`;
  return s;
}
export function formatRange(r, terms, langs = userLangs()) {
  const sym = r.unit ? unitSymbol(r.unit, terms) : '';
  const what = r.observedCharacteristic ? codeLabel(r.observedCharacteristic, terms).toLowerCase() + ' ' : '';
  const lo = r.lowerBound, hi = r.upperBound;
  const n = (x) => numberFmt(x, langs);
  const span = lo === hi ? `${n(lo)}` : lo != null && hi != null ? `${n(lo)} to ${n(hi)}` : lo != null ? `from ${n(lo)}` : `up to ${n(hi)}`;
  return `${what}${span}${sym ? (sym === '%' ? '' : ' ') + sym : ''}`.trim();
}

// plain-text rendering of any value (for search, tables, maps)
export function textOf(key, v, terms, langs = userLangs()) {
  switch (classify(key, v, terms)) {
    case 'empty': return '';
    case 'list': return v.map((x) => textOf(key, x, terms, langs)).join(', ');
    case 'boolean': return v ? 'Yes' : 'No';
    case 'number': return numberFmt(v, langs);
    case 'code': return codeLabel(v, terms);
    case 'country': return countryName(v, langs);
    case 'date': return formatDate(v, langs);
    case 'langtext': return pickLang(v, langs).text;
    case 'quantity': return formatQuantity(v, terms, langs);
    case 'range': return formatRange(v, terms, langs);
    case 'document': return v.resourceTitle || v.url;
    case 'record': return Object.entries(v).map(([k, x]) => textOf(k, x, terms, langs)).filter(Boolean).join(', ');
    default: return String(v);
  }
}

export function fieldLabel(key, terms) {
  let l = fieldOf(terms, key)?.label || key;
  // some EC core labels are just the camelCase field name: split them into words
  if (!/\s/.test(l) && /[a-z][A-Z]/.test(l)) l = l.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\bdpp\b/g, 'DPP');
  return l.charAt(0).toUpperCase() + l.slice(1);
}
// which audience may see a field: 'pub' or restricted levels
export function accessOf(key, terms) {
  const a = fieldOf(terms, key)?.access || [];
  return a.includes('pub') ? 'pub' : a.filter((x) => x !== 'pub');
}
export const ACCESS_LABELS = {
  pub: 'Public',
  res1: 'Restricted: people with a legitimate interest, notified bodies, market surveillance, the Commission',
  res2: 'Restricted: notified bodies, market surveillance, the Commission',
  res3: 'Restricted: people with a legitimate interest (individual battery)',
};

// May this audience see the field? audience: 'all' | 'pub' | 'res1' | 'res2' | 'res3'.
// Public fields are visible to everyone; restricted fields only to their own levels;
// fields with no access level in the vocabulary (core identifiers, units, values) follow
// their parent; fields the vocabulary doesn't know are shown only in 'all'.
export function visibleTo(key, audience, terms) {
  if (!audience || audience === 'all') return true;
  const f = fieldOf(terms, key);
  if (!f) return false;                       // not in the EC vocabulary: only in 'all'
  const a = f.access || [];
  if (!a.length) return true;                 // core and structural fields (ids, unit, value, …) carry no level: they go with their parent
  return a.includes('pub') || a.includes(audience);
}
export const AUDIENCES = [
  ['all', 'Everything in the file'],
  ['pub', 'The public'],
  ['res1', 'Legitimate interest, notified bodies, market surveillance, Commission'],
  ['res2', 'Notified bodies, market surveillance, Commission'],
  ['res3', 'Legitimate interest (individual battery)'],
];
// a copy of the passport with only the fields this audience may see (nested records too)
export function viewFor(passport, audience, terms) {
  if (!audience || audience === 'all') return passport;
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => visibleTo(k, audience, terms))
    .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) && classify(k, v, terms) === 'record' ? strip(v) : v]));
  return strip(passport);
}

// a field path like 'batteryIdentification.modelIdentifier' -> value
export function pathValue(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// title / subtitle / summary for cards, tables and maps
export function describe(passport, profile, terms, langs = userLangs()) {
  const first = (paths) => { for (const p of paths || []) { const v = pathValue(passport, p); if (v != null && v !== '') return { path: p, v }; } return null; };
  const t = first(profile?.title);
  const title = t ? textOf(t.path.split('.').pop(), t.v, terms, langs) : passport.digitalProductPassportId || 'Passport';
  const subtitle = (profile?.subtitle || []).map((p) => textOf(p, pathValue(passport, p), terms, langs)).filter(Boolean).join(' · ');
  const maker = textOf('manufacturerName', pathValue(passport, 'manufacturerIdentification.manufacturerName'), terms, langs);
  return { title, subtitle, maker };
}

// all field keys present, in profile order, then any others
export function orderedKeys(passport, profile) {
  const seen = new Set(), out = [];
  for (const g of profile?.groups || []) for (const k of g.fields) if (k in passport && !seen.has(k)) { seen.add(k); out.push(k); }
  for (const k of Object.keys(passport)) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}

// prefixed names for the structured (ladder) view
export const PREFIXES = [
  ['dpp:', EC + 'core/vocabs/core-vocabulary#'],
  ['dppcom:', EC + 'core/vocabs/common-vocabulary#'],
  ['bat:', EC + 'product/batteries/vocabs/battery-vocabulary#'],
  ['schema:', 'https://schema.org/'],
];
export function shortIri(iri) {
  for (const [p, ns] of PREFIXES) if (iri.startsWith(ns)) return p + iri.slice(ns.length);
  const m = /\/vocabs\/([^/#]+)#(.+)$/.exec(iri);
  return m ? `${m[1]}:${m[2]}` : iri;
}

// Plain-English summary from the profile's sentence templates. {path} is replaced by the
// value as text; modifiers: |long (code label without its short form, e.g. "Electric vehicle
// battery"), |a (adds "A"/"An"), |value (a quantity without its range). A sentence with any
// missing value is left out.
export function summarySentences(passport, profile, terms, langs = userLangs()) {
  const out = [];
  for (const tpl of profile?.sentences || []) {
    let missing = false;
    const text = tpl.replace(/\{([^}|]+)((?:\|[a-z]+)*)\}/g, (m, path, mods) => {
      const v = pathValue(passport, path);
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) { missing = true; return ''; }
      const flags = mods.split('|').filter(Boolean);
      const key = path.split('.').pop();
      let t;
      if (flags.includes('value') && v && typeof v === 'object' && 'value' in v) t = formatQuantity({ unit: v.unit, value: v.value }, terms, langs);
      else t = textOf(key, v, terms, langs);
      if (flags.includes('long')) t = t.split(', ').map((x) => (x.includes(' - ') ? x.split(' - ').slice(1).join(' - ') : x)).join(', ');
      if (flags.includes('a')) t = (/^[aeiou]/i.test(t) ? 'An ' : 'A ') + t.charAt(0).toLowerCase() + t.slice(1);
      return t;
    });
    if (!missing) out.push(text.charAt(0).toUpperCase() + text.slice(1));
  }
  return out;
}
