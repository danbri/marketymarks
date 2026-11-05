// shapes-to-jsonschema: compile a dpp-shapes shape tree (from the EC SHACL shapes) into a JSON
// Schema (2020-12) for EC passport JSON. The aim is equivalence: a passport should be valid
// against the compiled schema exactly when the EC's SHACL rules accept it (after the usual
// JSON-LD lifting with the EC context). Where JSON and RDF can't line up, the gap is listed
// in `x-dpp-gaps` rather than hidden.
//
// How SHACL maps onto JSON:
//   - a property with values: one value, or an array of values (JSON-LD treats both alike);
//     minCount/maxCount count values, so they become required + minItems/maxItems;
//   - a language string: an object of { "xx-YY": text }, one value per language, so maxCount
//     limits the number of languages; the EC language-tag rule becomes the key pattern;
//   - a codelist (sh:sparql skos:inScheme) becomes an enum of that scheme's concept IRIs;
//   - sh:hasValue / sh:or of values: an enum; sh:datatype: the JSON type plus a lexical pattern;
//   - sh:node / sh:and: a nested object schema; qualified counts: `contains` + min/maxContains;
//   - the unknown-field rule (SEM-COM-MSG-013): every object's keys must be EC vocabulary terms.

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const SH = 'http://www.w3.org/ns/shacl#';
const LANG_KEY = '^[A-Za-z]{2}-[A-Za-z]{2}$';   // the EC language-tag rule (SEM-COM-MSG-012)

const DATATYPE = {
  [XSD + 'string']: { type: 'string' },
  [XSD + 'anyURI']: { type: 'string' },
  [XSD + 'boolean']: { type: 'boolean' },
  [XSD + 'decimal']: { type: 'number' },
  [XSD + 'double']: { type: 'number' },
  [XSD + 'float']: { type: 'number' },
  [XSD + 'integer']: { type: 'integer' },
  [XSD + 'int']: { type: 'integer' },
  [XSD + 'long']: { type: 'integer' },
  [XSD + 'nonNegativeInteger']: { type: 'integer', minimum: 0 },
  [XSD + 'positiveInteger']: { type: 'integer', minimum: 1 },
  [XSD + 'dateTime']: { type: 'string', pattern: '^-?\\d{4,}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?$' },
  [XSD + 'date']: { type: 'string', pattern: '^-?\\d{4,}-\\d{2}-\\d{2}(Z|[+-]\\d{2}:\\d{2})?$' },
  [XSD + 'gYearMonth']: { type: 'string', pattern: '^-?\\d{4,}-(0[1-9]|1[0-2])(Z|[+-]\\d{2}:\\d{2})?$' },
  [XSD + 'gYear']: { type: 'string', pattern: '^-?\\d{4,}(Z|[+-]\\d{2}:\\d{2})?$' },
};

// What JSON values JSON-LD turns into a literal of datatype D, given the term's context.
// Coerced terms ("@type": D) turn strings, and numbers or booleans by their canonical form,
// into D literals; uncoerced terms give xsd:string for strings, xsd:integer / xsd:double for
// numbers and xsd:boolean for booleans.
const LEX = {
  [XSD + 'integer']: '^[+-]?\\d+$', [XSD + 'int']: '^[+-]?\\d+$', [XSD + 'long']: '^[+-]?\\d+$',
  [XSD + 'nonNegativeInteger']: '^(\\+?\\d+|-0+)$', [XSD + 'positiveInteger']: '^\\+?0*[1-9]\\d*$',
  [XSD + 'decimal']: '^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)$',
  [XSD + 'double']: '^([+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?|[+-]?INF|NaN)$',
  [XSD + 'boolean']: '^(true|false|1|0)$',
};
function literalSchema(dt, coercedTo) {
  const base = DATATYPE[dt];
  if (!base) return null;
  if (coercedTo && coercedTo === dt) {
    if (dt === XSD + 'string') return { type: ['string', 'number', 'boolean'] };
    if (LEX[dt]) {
      const alts = [{ type: 'string', pattern: LEX[dt] }];
      if (base.type === 'integer') alts.push({ type: 'integer', ...(base.minimum != null && { minimum: base.minimum }) });
      if (base.type === 'number') alts.push({ type: 'number' });
      if (base.type === 'boolean') alts.push({ type: 'boolean' }, { enum: [0, 1] });
      return { anyOf: alts };
    }
    return { ...base };
  }
  // not coerced: JSON's own types
  if (dt === XSD + 'string') return { type: 'string' };
  if (dt === XSD + 'boolean') return { type: 'boolean' };
  if (dt === XSD + 'integer') return { type: 'integer' };
  if (dt === XSD + 'double') return { type: 'number', not: { type: 'integer' } };
  if (dt === XSD + 'decimal') return { not: {} };               // plain JSON never yields xsd:decimal
  return { ...base, not: {} };                                   // other datatypes need coercion
}

// terms: the ec-1.0.0-terms.json object (field keys, codes and their schemes)
// context: the flattened EC JSON-LD context for this rule set (for datatype coercion)
export function compile(tree, terms, { id, title, context = {} } = {}) {
  const coercion = (k, ctx) => { const d = ctx[k]; const t = d && typeof d === 'object' ? d['@type'] : null; return t && t.startsWith('xsd:') ? XSD + t.slice(4) : t; };
  const closedEverywhere = !!tree.root.closed;
  // a term's scoped context (JSON-LD 1.1) applies inside its value
  const inner = (ctx, k) => { const d = ctx[k]; return d && typeof d === 'object' && d['@context'] ? { ...ctx, ...d['@context'] } : ctx; };
  const gaps = new Set();
  const vocabKeys = [...Object.keys(terms.fields)].sort();
  const conceptsOf = (schemeIri) => Object.entries(terms.codes).filter(([, c]) => c.scheme && schemeIri.endsWith('/' + c.scheme)).map(([iri]) => iri).sort();

  function itemSchema(p, k, ctx) {
    if (p.langMap || p.datatypes.includes(RDF + 'langString')) {
      return { type: 'object', propertyNames: { pattern: LANG_KEY }, additionalProperties: { type: 'string' } };
    }
    const allowed = [...p.values];
    for (const s of p.codelists) {
      const c = conceptsOf(s);
      if (!c.length) gaps.add(`codelist ${s} has no concepts in the vocabularies`);
      allowed.push(...c);
    }
    if (allowed.length) return { enum: [...new Set(allowed)] };
    if (p.alternatives) return { anyOf: p.alternatives.map((n) => nodeSchema(n, inner(ctx, k))) };
    if (p.node) return nodeSchema(p.node, inner(ctx, k));
    if (p.nodeKind === SH + 'IRI') return { type: 'string', minLength: 1 };
    const dts = p.datatypes.map((d) => literalSchema(d, coercion(k, ctx)) || (gaps.add(`datatype ${d} not mapped`), {}));
    let s = dts.length === 1 ? { ...dts[0] } : dts.length > 1 ? { anyOf: dts } : {};
    if (p.patterns.length === 1) s.pattern = p.patterns[0];
    else if (p.patterns.length > 1) s.allOf = p.patterns.map((x) => ({ pattern: x }));
    if (p.patterns.length && !s.type && !s.anyOf) s.type = 'string';
    return s;
  }
  function propSchema(p, k, ctx) {
    const item = itemSchema(p, k, ctx);
    const lang = item.propertyNames?.pattern === LANG_KEY;
    if (lang) {
      // one value per language: cardinality counts languages
      const s = { ...item };
      if (p.min > 0) s.minProperties = p.min;
      if (p.max != null) s.maxProperties = p.max;
      return s;
    }
    const arr = { type: 'array', items: item };
    if (p.min > 0) arr.minItems = p.min;
    if (p.max != null) arr.maxItems = p.max;
    // qualified counts: each becomes a contains clause (several may apply at once)
    const containsClauses = p.qualified.map((q) => ({ contains: q.patterns.length ? { type: 'string', pattern: q.patterns[0] } : {},
      ...(q.min != null && { minContains: q.min }), ...(q.max != null && { maxContains: q.max }) }));
    if (containsClauses.length === 1) Object.assign(arr, containsClauses[0]);
    else if (containsClauses.length > 1) arr.allOf = containsClauses;
    // a single (non-array) value: allowed when one value can satisfy the counts
    const needs = p.qualified.filter((q) => (q.min ?? 0) >= 1).length;
    if (p.min > 1 || needs > 1 || (p.max != null && p.max < 1)) return arr;
    const single = needs === 1
      ? { allOf: [item, { type: 'string', pattern: p.qualified.find((q) => (q.min ?? 0) >= 1).patterns[0] }] }
      : item;
    return { anyOf: [single, arr] };
  }
  function nodeSchema(n, ctx = context) {
    // the unknown-field rule (when the passport shape has it) reaches every node of the passport
    const s = { type: 'object', properties: {}, ...(closedEverywhere && { propertyNames: { enum: vocabKeys } }) };
    const required = [];
    for (const [k, p] of Object.entries(n.props)) {
      s.properties[k] = propSchema(p, k, ctx);
      if (p.min > 0 || p.qualified.some((q) => (q.min ?? 0) > 0)) required.push(k);   // a qualified minimum also needs the field
      if (p.messages.length) s.properties[k]['x-ec-codes'] = p.messages;
    }
    if (required.length) s.required = required.sort();
    // node-level sh:or groups: at least one alternative per group
    for (const group of n.anyOf || []) (s.allOf ||= []).push({ anyOf: group.map((alt) => { const a = nodeSchema(alt, ctx); delete a.propertyNames; delete a.type; return a; }) });
    return s;
  }
  const root = nodeSchema(tree.root);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...(id && { $id: id }), title: title || `EC DPP ${tree.release} ${tree.product || 'core'}${tree.sub ? '/' + tree.sub : ''} (${tree.view})`,
    description: 'Compiled from the EC SHACL shapes. Valid here should mean the EC SHACL rules accept the passport.',
    ...root,
    'x-dpp-gaps': [...gaps],
  };
}
