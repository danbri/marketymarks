// dpp-check: check an EU Digital Product Passport (EC JSON) against the EC's own
// semantic data artifacts (release 1.0.0), using @factoidal/core.
//
// The same module runs in the browser and in Node. The caller passes:
//   F     the @factoidal/core module
//   load  async (path) => text, for a path inside the EC release folder
//         (e.g. 'core/1.0.0/shapes/core-shapes.ttl')
//
// Factoidal 0.29.0 and 0.30.0 have two SHACL gaps that would make an EC check pass
// passports it should fail. This module works around both, and says so in its
// output:
//   1. sh:sparql on a property shape, or in a shape reached through sh:node,
//      is not evaluated. Fix here: copy such constraints onto the node shape
//      (with $PATH replaced by the property), and give nested shapes their own
//      target (sh:targetObjectsOf the property).
//   2. The EC "unknown field" rule (SEM-COM-MSG-013) uses a property path that
//      is very slow once the EC vocabularies are merged into the data. Fix
//      here: run that one rule on the passport data alone, and every other
//      rule on passport + vocabularies (the codelist rules need the
//      vocabularies; the unknown-field rule never looks at them).
// It also refuses to report "passes" when no passport node was checked at all
// (for example a passport with no @type would otherwise pass every rule).

export const EC = 'https://repository.product-passport.ec.europa.eu/';
const SH = 'http://www.w3.org/ns/shacl#';
const DPP_TYPE = EC + 'core/vocabs/core-vocabulary#DigitalProductPassport';
const UNKNOWN_FIELD_RULE = 'SEM-COM-MSG-013';
const VIEWS = ['pub', 'res1', 'res2', 'res3'];
export const VIEW_LABELS = {
  all: 'Full passport (all fields)',
  pub: 'Public view',
  res1: 'Restricted view 1 (e.g. notified bodies, market surveillance, Commission)',
  res2: 'Restricted view 2',
  res3: 'Restricted view 3 (legitimate interest, e.g. repairers, recyclers)',
};

const CONTEXTS = {
  core: 'core/1.0.0/contexts/core-context.jsonld',
  batteries: 'product/batteries/1.0.0/contexts/batteries-context.jsonld',
  evb: 'product/batteries/subgroup/evb/1.0.0/contexts/evb-context.jsonld',
  ind: 'product/batteries/subgroup/ind/1.0.0/contexts/ind-context.jsonld',
  lmt: 'product/batteries/subgroup/lmt/1.0.0/contexts/lmt-context.jsonld',
};
export const SUBGROUP_LABELS = {
  evb: 'Electric vehicle battery', ind: 'Industrial battery', lmt: 'Light means of transport battery',
};

// Which EC rule set a passport claims, from its contentSpecificationIds.
export function detectProfile(passport) {
  const ids = Array.isArray(passport?.contentSpecificationIds) ? passport.contentSpecificationIds : [];
  const has = (s) => ids.some((x) => typeof x === 'string' && x.startsWith(EC + s));
  const sub = ['evb', 'ind', 'lmt'].find((s) => has(`product/batteries/subgroup/${s}/`)) || null;
  const product = sub || has('product/batteries/') ? 'batteries' : null;
  return { product, sub, ids };
}

// Resolve a relative path the way the EC files' relative @import paths expect.
const resolve = (base, rel) => new URL(rel, 'http://x/' + base).pathname.slice(1);

// The EC subgroup contexts chain @import, which JSON-LD 1.1 does not allow.
// Flatten them: imported terms first, local terms override.
async function flatContext(load, path) {
  const ctx = JSON.parse(await load(path))['@context'];
  if (!ctx['@import']) return { ...ctx };
  const { ['@import']: imp, ...local } = ctx;
  return { ...(await flatContext(load, resolve(path, imp))), ...local };
}

function shapeFiles({ view, sub, product }) {
  const files = ['core/1.0.0/shapes/core-shapes.ttl', 'core/1.0.0/shapes/common-shapes.ttl'];
  const views = view === 'all' ? VIEWS : [view];
  if (product) for (const v of views) files.push(`product/batteries/1.0.0/shapes/${v}-batteries-shapes.ttl`);
  if (sub) for (const v of views) files.push(`product/batteries/subgroup/${sub}/1.0.0/shapes/${v}-${sub}-shapes.ttl`);
  return files;
}

async function parseAll(F, load, files) {
  let ds = null;
  for (const f of files) {
    const d = await F.parse(await load(f), { format: 'turtle', baseIRI: EC + f });
    ds = ds ? await F.datasetMerge(ds, d) : d;
  }
  return ds;
}

export class Checker {
  constructor(F, load) { this.F = F; this.load = load; this.cache = {}; }

  async manifest() {
    return (this.cache.manifest ??= JSON.parse(await this.load('manifest.json')));
  }
  async vocabularies() {
    if (!this.cache.vocabs) {
      const m = await this.manifest();
      this.cache.vocabs = parseAll(this.F, this.load, m.files.filter((f) => f.includes('/vocabs/')));
    }
    return this.cache.vocabs;
  }
  // error code -> plain-English definition, from the EC error-code vocabularies
  async messages() {
    if (!this.cache.msgs) {
      this.cache.msgs = (async () => {
        const rows = await (await this.vocabularies()).query(`PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          SELECT ?n ?d WHERE { ?c skos:notation ?n ; skos:definition ?d }`);
        return new Map(rows.map((r) => [r.get('n').value, r.get('d').value]));
      })();
    }
    return this.cache.msgs;
  }

  async shapes(profile, view) {
    const F = this.F;
    const shapes = await parseAll(F, this.load, shapeFiles({ ...profile, view }));
    if (view.startsWith('res')) {
      // a restricted view is a partial passport: keep the core shape
      // definitions but don't require every core field
      await shapes.update(`PREFIX sh: <${SH}> DELETE { ?s sh:targetClass ?c } WHERE { ?s sh:targetClass ?c
        FILTER(STRSTARTS(STR(?s), "${EC}core/shapes/")) }`);
    }
    // workaround 1a: copy property-level sh:sparql onto the owning node shape
    await shapes.update(`PREFIX sh: <${SH}>
      DELETE { ?ps sh:sparql ?c }
      INSERT { ?ns sh:sparql ?c2 . ?c2 a sh:SPARQLConstraint ; sh:select ?q2 ; sh:message ?m ; sh:prefixes ?pf ; <urn:dpp-check:field> ?p }
      WHERE { ?ns sh:property ?ps . ?ps sh:path ?p ; sh:sparql ?c . ?c sh:select ?q0 .
              FILTER(isIRI(?p) || !CONTAINS(STR(?q0), "$PATH"))
              ?c sh:select ?q . OPTIONAL { ?c sh:message ?m0 } OPTIONAL { ?ps sh:message ?m1 } OPTIONAL { ?c sh:prefixes ?pf }
              BIND(COALESCE(?m0, ?m1) AS ?m)
              BIND(IF(isIRI(?p), REPLACE(?q, "\\\\$PATH", CONCAT("<", STR(?p), ">")), ?q) AS ?q1)
              # EC 1.0.0 language-tag rules say SELECT $this (?value AS ?path), which puts the bad value
              # where SHACL expects the field; report the value as ?value and the property as ?path
              BIND(IF(isIRI(?p), REPLACE(?q1, "\\\\(\\\\?value AS \\\\?path\\\\)", CONCAT("?value (<", STR(?p), "> AS ?path)")), ?q1) AS ?q2)
              BIND(BNODE() AS ?c2)
              FILTER(BOUND(?q2)) }`);  // never drop a rule whose rewrite failed
    // the same EC language-tag pattern in rules that were not moved (e.g. in nested shapes): report
    // ?value as the value, and take the field from the rule's own triple pattern ($this <field> ?value)
    await shapes.update(`PREFIX sh: <${SH}>
      DELETE { ?c sh:select ?q } INSERT { ?c sh:select ?q2 }
      WHERE { ?c sh:select ?q . FILTER(CONTAINS(?q, "(?value AS ?path)"))
              BIND(REPLACE(?q, "^.*?\\\\$this\\\\s+(\\\\S+)\\\\s+\\\\?value.*$", "$1", "s") AS ?prop)
              # use the extracted name only if it is one token; otherwise just report ?value
              BIND(IF(REGEX(?prop, "^[A-Za-z][A-Za-z0-9_.-]*:[A-Za-z0-9_.-]+$|^<[^> ]+>$"), CONCAT("?value (", ?prop, " AS ?path)"), "?value") AS ?sel)
              BIND(REPLACE(?q, "\\\\(\\\\?value AS \\\\?path\\\\)", ?sel) AS ?q2)
              FILTER(BOUND(?q2) && CONTAINS(?q2, "SELECT")) }`);  // never delete a rule whose rewrite failed
    // workaround 1b: give shapes reached only via sh:node their own target
    await shapes.update(`PREFIX sh: <${SH}> INSERT { ?child sh:targetObjectsOf ?p } WHERE {
      ?ps sh:path ?p ; sh:node ?child . ?child sh:sparql ?c . FILTER(isIRI(?p)) }`);
    // EC error code -> the field its rule is about (for rules whose results carry no sh:resultPath)
    const fieldRows = await shapes.query(`PREFIX sh: <${SH}> SELECT ?m ?p WHERE {
      { ?c sh:message ?m ; <urn:dpp-check:field> ?p } UNION { ?ps sh:path ?p ; sh:message ?m FILTER(isIRI(?p)) }
      UNION { ?ps sh:path ?p ; sh:sparql ?c . ?c sh:message ?m FILTER(isIRI(?p)) } }`);
    // only codes that belong to exactly one field (the EC reuses some codes, e.g. the language-tag rule, across many fields)
    const seen = new Map();
    for (const r of fieldRows) {
      const m = r.get('m').value, f = r.get('p').value.replace(/.*[#/]/, '');
      seen.set(m, (seen.get(m) || new Set()).add(f));
    }
    const fieldOf = new Map([...seen].filter(([, fs]) => fs.size === 1).map(([m, fs]) => [m, [...fs][0]]));
    const left = await shapes.query(`PREFIX sh: <${SH}> SELECT (COUNT(*) AS ?n) WHERE { ?ps sh:path ?p ; sh:sparql ?c }`);
    // workaround 2: split out the unknown-field rule
    const rows = await shapes.query(`PREFIX sh: <${SH}> SELECT ?tc ?q WHERE { ?s sh:sparql ?c .
      ?c sh:message "${UNKNOWN_FIELD_RULE}" ; sh:select ?q . ?s sh:targetClass ?tc }`);
    await shapes.update(`PREFIX sh: <${SH}> DELETE { ?s sh:sparql ?c . ?c ?p ?o } WHERE {
      ?s sh:sparql ?c . ?c sh:message "${UNKNOWN_FIELD_RULE}" ; ?p ?o }`);
    let ttl = `@prefix sh: <${SH}> .\n`;
    for (const r of rows) {
      ttl += `<urn:dpp-check:unknown-fields> a sh:NodeShape ; sh:targetClass <${r.get('tc').value}> ; ` +
        `sh:sparql [ a sh:SPARQLConstraint ; sh:message "${UNKNOWN_FIELD_RULE}" ; sh:select ${JSON.stringify(r.get('q').value)} ] .\n`;
    }
    return {
      main: shapes,
      unknownFields: rows.length ? await F.parse(ttl, 'turtle') : null,
      files: shapeFiles({ ...profile, view }),
      untouchedPropertyRules: Number(left[0].get('n').value),
      fieldOf,
    };
  }

  // Turn EC JSON into RDF with the right (flattened) EC context.
  async toRDF(passport, profile) {
    const ctx = await flatContext(this.load, CONTEXTS[profile.sub || profile.product || 'core']);
    const doc = { '@context': ctx, '@type': 'dpp:DigitalProductPassport', ...passport };
    if (passport.digitalProductPassportId) doc['@id'] = passport.digitalProductPassportId;
    return this.F.jsonldToRdf(JSON.stringify(doc));
  }

  async results(report, fieldOf = new Map()) {
    const rows = await report.query(`PREFIX sh: <${SH}> SELECT ?focus ?path ?msg ?comp ?val ?sev WHERE {
      ?r a sh:ValidationResult ; sh:focusNode ?focus . OPTIONAL { ?r sh:resultPath ?path }
      OPTIONAL { ?r sh:resultMessage ?msg } OPTIONAL { ?r sh:sourceConstraintComponent ?comp }
      OPTIONAL { ?r sh:value ?val } OPTIONAL { ?r sh:resultSeverity ?sev } }`);
    const msgs = await this.messages();
    return rows.map((r) => {
      const code = r.get('msg')?.value;
      const path = r.get('path');
      const field = (path?.termType === 'NamedNode' ? path.value.replace(/.*[#/]/, '') : null) || fieldOf.get(code) || null;
      // EC 1.0.0 language-tag rules bind the offending value to ?path (a literal); show it as the value
      const pathValue = path?.termType === 'Literal' ? `${path.value}${path.language ? '@' + path.language : ''}` : null;
      return {
        code,
        explanation: (msgs.get(code) || '').replace(/\{\{\s*field\s*\}\}/g, field || 'this field') || null,
        field,
        // a blank-node value is an internal ID for a nested object, meaningless to a reader
        value: pathValue ?? (r.get('val')?.termType === 'BlankNode' ? null : r.get('val')?.value) ?? null,
        nested: r.get('val')?.termType === 'BlankNode' || r.get('focus')?.termType === 'BlankNode',
        rule: r.get('comp')?.value?.replace(SH, 'sh:') || null,
        focus: r.get('focus')?.value,
      };
    });
  }

  // Check one passport. `view` is 'all' or one of pub/res1/res2/res3.
  async check(passport, { view = 'all', profile = detectProfile(passport) } = {}) {
    const F = this.F, t0 = Date.now();
    if (!passport || typeof passport !== 'object' || Array.isArray(passport)) throw new Error('A passport must be a JSON object.');
    const notes = [];
    if (!profile.ids.length) notes.push('No contentSpecificationIds: checked against the core rules only.');
    const data = await this.toRDF(passport, profile);
    const sh = await this.shapes(profile, view);
    const main = await F.shaclValidate(await F.datasetMerge(data, await this.vocabularies()), sh.main);
    const unk = sh.unknownFields ? await F.shaclValidate(data, sh.unknownFields) : { conforms: true, report: null };
    const all = [...await this.results(main.report, sh.fieldOf), ...(unk.report ? await this.results(unk.report, sh.fieldOf) : [])];
    const keyOf = (p) => [p.code, p.field, p.value, p.focus].join('\u0000');
    const uniq = [...new Map(all.map((p) => [keyOf(p), p])).values()];
    // when two EC rules report the same code on the same field, keep the one that names the value
    const problems = uniq.filter((p) => p.value != null || !uniq.some((q) => q !== p && q.value != null && q.code === p.code && q.field === p.field));
    const typed = await data.query(`SELECT (COUNT(*) AS ?n) WHERE { ?s a <${DPP_TYPE}> }`);
    const checkedNodes = Number(typed[0].get('n').value);
    let verdict = main.conforms && unk.conforms ? 'passes' : 'fails';
    if (checkedNodes === 0) { verdict = 'not-checked'; notes.push('No passport node was found, so no rule applied. This is not a pass.'); }
    if (sh.untouchedPropertyRules) notes.push(`${sh.untouchedPropertyRules} property-level SPARQL rule(s) could not be moved and may not have been evaluated.`);
    return {
      verdict, problems, notes, view, profile: { product: profile.product, sub: profile.sub },
      triples: data.size, checkedNodes, shapeFiles: sh.files, ms: Date.now() - t0,
    };
  }

  // Must-fail test inputs: each is a valid EC sample with one deliberate error.
  // If any of these passes, this checker cannot be trusted on this engine.
  async selfTest() {
    const base = JSON.parse(await this.load('product/batteries/subgroup/evb/1.0.0/tests/conforms/pub-batteries-evb.json'));
    const cases = [
      ['valid EC sample (must pass)', base, 'pub', 'passes'],
      ['unknown battery category code', { ...base, batteryCategory: EC + 'product/batteries/vocabs/battery-category#flyingCarBattery' }, 'pub', 'fails'],
      ['unknown granularity code', { ...base, granularity: EC + 'core/vocabs/granularity-level#galaxy' }, 'pub', 'fails'],
      ['field not in the EC model', { ...base, totallyUnknownField: 'x' }, 'pub', 'fails'],
      ['bad language tag', { ...base, extinguishingAgent: { english: 'water' } }, 'pub', 'fails'],
      ['bad language tag in a nested object', { ...base, wasteBatteryPreventionManagementInfo: { ...base.wasteBatteryPreventionManagementInfo, endUserRoleInWastePrevention: { en: 'x' } } }, 'pub', 'fails'],
      ['passport that names no EC rule set (core only)', { ...base, contentSpecificationIds: [] }, 'pub', 'fails'],
    ];
    const out = [];
    for (const [name, passport, view, expected] of cases) {
      const r = await this.check(passport, { view });
      out.push({ name, expected, got: r.verdict, ok: r.verdict === expected, codes: [...new Set(r.problems.map((p) => p.code).filter(Boolean))] });
    }
    return out;
  }

  async samples() {
    return (await this.manifest()).files.filter((f) => f.includes('/tests/conforms/'));
  }
}
