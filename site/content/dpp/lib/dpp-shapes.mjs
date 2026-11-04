// dpp-shapes: read the EC's SHACL shapes (release 1.0.0) into a plain "shape tree" that other
// tools can use without an RDF engine: a JSON Schema compiler, shape-driven displays and
// authoring forms. One tree per rule set (core / batteries + subgroup) and view (all/pub/res1-3).
//
// The EC shapes use a small part of SHACL, all handled here: property shapes with path
// (and one alternativePath), min/maxCount, datatype, nodeKind, pattern, hasValue, and/or,
// node, qualifiedValueShape with qualified min/max, and sh:sparql constraints. The SPARQL
// constraints are recognised by what they check: codelist membership (skos:inScheme <scheme>),
// language tags (SEM-COM-MSG-012) and unknown fields (SEM-COM-MSG-013).
//
// Shape tree:
//   Node  = { props: { [jsonKey]: Prop }, closed: bool }
//   Prop  = { iri, min, max, datatypes[], nodeKind, patterns[], values[] (allowed IRIs/values),
//             codelists[] (scheme IRIs), langMap: bool, node: Node|null, alternatives: Node[]|null,
//             qualified: [{ min, max, datatypes[], patterns[] }], messages[] (EC error codes) }

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const EC = 'https://repository.product-passport.ec.europa.eu/';
const DPP_CLASS = EC + 'core/vocabs/core-vocabulary#DigitalProductPassport';
const VIEWS = ['pub', 'res1', 'res2', 'res3'];

export function shapeFiles({ view, sub, product }) {
  const files = ['core/1.0.0/shapes/core-shapes.ttl', 'core/1.0.0/shapes/common-shapes.ttl'];
  const views = view === 'all' ? VIEWS : [view];
  if (product) for (const v of views) files.push(`product/batteries/1.0.0/shapes/${v}-batteries-shapes.ttl`);
  if (sub) for (const v of views) files.push(`product/batteries/subgroup/${sub}/1.0.0/shapes/${v}-${sub}-shapes.ttl`);
  return files;
}

// index the shapes graph: subject -> predicate -> [objects]
function indexOf(ds) {
  const idx = new Map();
  for (const q of ds) {
    const s = q.subject.termType === 'BlankNode' ? '_:' + q.subject.value : q.subject.value;
    if (!idx.has(s)) idx.set(s, new Map());
    const m = idx.get(s);
    if (!m.has(q.predicate.value)) m.set(q.predicate.value, []);
    m.get(q.predicate.value).push(q.object);
  }
  return idx;
}
const id = (t) => (t.termType === 'BlankNode' ? '_:' + t.value : t.value);
const XSD = 'http://www.w3.org/2001/XMLSchema#';
// an RDF term as the JSON value that would produce it (IRIs and strings as strings)
function jsonValue(t) {
  if (t.termType !== 'Literal') return t.value;
  const dt = t.datatype?.value || '';
  if (dt === XSD + 'boolean') return t.value === 'true' || t.value === '1';
  if (/#(integer|int|long|decimal|double|float|nonNegativeInteger|positiveInteger)$/.test(dt)) return Number(t.value);
  return t.value;
}

export async function extractShapes(F, load, { view = 'all', sub = null, product = 'batteries', keyOf }) {
  let ds = null;
  for (const f of shapeFiles({ view, sub, product })) {
    const d = await F.parse(await load(f), { format: 'turtle', baseIRI: EC + f });
    ds = ds ? await F.datasetMerge(ds, d) : d;
  }
  const idx = indexOf(ds);
  const get = (s, p) => idx.get(s)?.get(p) || [];
  const one = (s, p) => get(s, p)[0];
  const list = (head) => { const out = []; let n = head; while (n && n.value !== RDF + 'nil') { const f = one(id(n), RDF + 'first'); if (f) out.push(f); n = one(id(n), RDF + 'rest'); } return out; };
  const key = (iri) => (keyOf ? keyOf(iri) : iri.replace(/.*[#/]/, ''));
  const num = (t) => (t ? Number(t.value) : null);

  function emptyProp(iri) { return { iri, min: 0, max: null, datatypes: [], nodeKind: null, patterns: [], values: [], codelists: [], langMap: false, node: null, alternatives: null, qualified: [], messages: [] }; }
  function mergeProp(a, b) {
    const inter = (x, y) => (x.length && y.length ? x.filter((v) => y.includes(v)) : x.length ? x : y);
    return {
      iri: a.iri || b.iri, min: Math.max(a.min, b.min), max: a.max == null ? b.max : b.max == null ? a.max : Math.min(a.max, b.max),
      datatypes: inter(a.datatypes, b.datatypes), nodeKind: a.nodeKind || b.nodeKind, patterns: [...new Set([...a.patterns, ...b.patterns])],
      values: inter(a.values, b.values), codelists: [...new Set([...a.codelists, ...b.codelists])], langMap: a.langMap || b.langMap,
      node: a.node && b.node ? mergeNode(a.node, b.node) : a.node || b.node, alternatives: a.alternatives || b.alternatives,
      qualified: [...a.qualified, ...b.qualified], messages: [...new Set([...a.messages, ...b.messages])],
    };
  }
  function mergeNode(a, b) {
    const props = { ...a.props };
    for (const [k, p] of Object.entries(b.props)) props[k] = props[k] ? mergeProp(props[k], p) : p;
    const anyOf = [...(a.anyOf || []), ...(b.anyOf || [])];
    return { props, closed: a.closed || b.closed, ...(anyOf.length && { anyOf }) };
  }
  // what a sh:sparql constraint checks
  function sparqlKind(c) {
    const q = one(id(c), SH + 'select')?.value || '', m = one(id(c), SH + 'message')?.value || '';
    const scheme = /skos:inScheme\s+<([^>]+)>/.exec(q)?.[1];
    if (scheme) return { codelist: scheme, message: m };
    if (m === 'SEM-COM-MSG-012' || /lang\(\?value\)/.test(q)) return { langMap: true, message: m };
    if (m === 'SEM-COM-MSG-013') return { closed: true, message: m };
    return { other: true, message: m };
  }
  // the constraints a shape puts on value nodes, as a Node (props) plus value-level facets
  function normNode(n, seen = new Set(), extraProps = null) {
    const s = id(n); if (!extraProps && seen.has(s)) return { props: {}, closed: false }; if (!extraProps) seen = new Set(seen).add(s);
    let node = { props: {}, closed: false };
    if (extraProps) { for (const ps of extraProps) { const p = normProp(ps, seen); for (const one of p.alternativePath ? p.alternativePath.map((iri) => ({ ...p, iri, alternativePath: undefined, min: 0, max: null })) : [p]) node.props[key(one.iri)] = node.props[key(one.iri)] ? mergeProp(node.props[key(one.iri)], one) : one; } return node; }
    const add = (p) => {
      // an alternative path (p1|p2|…) puts its constraint on each of the alternatives
      for (const one of p.alternativePath ? p.alternativePath.map((iri) => ({ ...p, iri, alternativePath: undefined, min: 0, max: null })) : [p]) {
        const k = key(one.iri); node.props[k] = node.props[k] ? mergeProp(node.props[k], one) : one;
      }
    };
    if (one(s, SH + 'path')) add(normProp(n, seen));
    for (const ps of get(s, SH + 'property')) add(normProp(ps, seen));
    for (const l of get(s, SH + 'and')) for (const m of list(l)) node = mergeNode(node, normNode(m, seen));
    for (const m of get(s, SH + 'node')) node = mergeNode(node, normNode(m, seen));
    for (const c of get(s, SH + 'sparql')) if (sparqlKind(c).closed) node.closed = true;
    // node-level sh:or: the value must match at least one alternative
    for (const l of get(s, SH + 'or')) node.anyOf = [...(node.anyOf || []), list(l).map((m) => normNode(m, seen))];
    return node;
  }
  function normProp(ps, seen) {
    const s = id(ps);
    const path = one(s, SH + 'path');
    let iri = path?.termType === 'NamedNode' ? path.value : null;
    let p = emptyProp(iri);
    if (path && path.termType === 'BlankNode') {
      const alts = list(one(id(path), SH + 'alternativePath')); p.iri = null; p.alternativePath = alts.map((a) => a.value);
    }
    p.min = num(one(s, SH + 'minCount')) ?? 0;
    p.max = num(one(s, SH + 'maxCount'));
    p.datatypes = get(s, SH + 'datatype').map((t) => t.value);
    p.nodeKind = one(s, SH + 'nodeKind')?.value || null;
    p.patterns = get(s, SH + 'pattern').map((t) => t.value);
    p.values = get(s, SH + 'hasValue').map(jsonValue);
    p.messages = get(s, SH + 'message').map((t) => t.value);
    for (const l of get(s, SH + 'or')) {
      const members = list(l);
      const hv = members.flatMap((m) => get(id(m), SH + 'hasValue').map(jsonValue));
      const dt = members.flatMap((m) => get(id(m), SH + 'datatype').map((t) => t.value));
      if (hv.length === members.length) p.values = p.values.length ? p.values.filter((v) => hv.includes(v)) : hv;
      else if (dt.length === members.length) p.datatypes = p.datatypes.length ? p.datatypes : dt;
      else p.alternatives = members.map((m) => normNode(m, seen));
    }
    const valueNode = { props: {}, closed: false };
    let vn = valueNode;
    for (const ps2 of get(s, SH + 'property')) vn = mergeNode(vn, normNode({ termType: 'BlankNode', value: '__wrap' }, seen, [ps2]));
    for (const l of get(s, SH + 'and')) for (const m of list(l)) vn = mergeNode(vn, normNode(m, seen));
    for (const m of get(s, SH + 'node')) vn = mergeNode(vn, normNode(m, seen));
    if (Object.keys(vn.props).length || vn.closed) p.node = vn;
    for (const qv of get(s, SH + 'qualifiedValueShape')) {
      p.qualified.push({ min: num(one(s, SH + 'qualifiedMinCount')), max: num(one(s, SH + 'qualifiedMaxCount')),
        datatypes: get(id(qv), SH + 'datatype').map((t) => t.value), patterns: get(id(qv), SH + 'pattern').map((t) => t.value) });
    }
    for (const c of get(s, SH + 'sparql')) {
      const k = sparqlKind(c);
      if (k.codelist) p.codelists.push(k.codelist);
      if (k.langMap) p.langMap = true;
      if (k.message && !p.messages.includes(k.message)) p.messages.push(k.message);
    }
    return p;
  }

  // the passport: every node shape that targets dpp:DigitalProductPassport, merged
  // (for restricted views the core shapes are not targeted: a restricted view is a partial passport)
  let root = { props: {}, closed: false };
  for (const [s, m] of idx) {
    if (!(m.get(SH + 'targetClass') || []).some((t) => t.value === DPP_CLASS)) continue;
    if (view.startsWith('res') && s.startsWith(EC + 'core/shapes/')) continue;
    root = mergeNode(root, normNode({ termType: s.startsWith('_:') ? 'BlankNode' : 'NamedNode', value: s.replace(/^_:/, '') }));
  }
  return { release: '1.0.0', view, product, sub, root };
}
