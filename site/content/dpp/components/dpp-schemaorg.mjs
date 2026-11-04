// dpp-schemaorg: an EC DPP (EC JSON) seen as schema.org, including the pending
// Digital Product Passport vocabulary (schema.org issue 4870, pending.schema.org):
// DigitalProductPassport, hasDigitalProductPassport, DeclarationOfConformity,
// substanceOfConcern, recycledContentPercentage, importer, authorizedRepresentative.
// Units use UN/CEFACT common codes, as schema.org's unitCode expects.

import { textOf, codeLabel, countryName, pickLang, isLangMap, fieldLabel, describe, classify, fieldOf, codeOf } from './dpp-model.mjs';

export const PENDING = new Set(['DigitalProductPassport', 'hasDigitalProductPassport', 'DeclarationOfConformity',
  'EnvironmentalProductDeclaration', 'substanceOfConcern', 'recycledContentPercentage', 'importer', 'authorizedRepresentative']);

const UNIT_CODES = { kilogram: 'KGM', gram: 'GRM', ampereHour: 'AMH', milliampereHour: 'E09', percent: 'P1', volt: 'VLT',
  degreeCelsius: 'CEL', watt: 'WTT', ohm: 'OHM', reciprocalHour: 'H10', hour: 'HUR' };
const local = (iri) => String(iri).replace(/.*[#/]/, '');
const qv = (q, terms) => {
  const o = { '@type': 'QuantitativeValue', value: q.value };
  const u = local(q.unit);
  if (UNIT_CODES[u]) o.unitCode = UNIT_CODES[u];
  o.unitText = codeOf(terms, q.unit)?.symbol || codeOf(terms, q.unit)?.label || u;
  if (q.valueRange) {
    if (q.valueRange.lowerBound != null) o.minValue = q.valueRange.lowerBound;
    if (q.valueRange.upperBound != null) o.maxValue = q.valueRange.upperBound;
  }
  return o;
};
const text = (v, langs) => (isLangMap(v) ? pickLang(v, langs).text : v);

// fields that have a direct schema.org home; everything else measurable goes to additionalProperty
const DIRECT = new Set(['digitalProductPassportId', 'uniqueProductIdentifier', 'granularity', 'dppStatus', 'lastUpdate',
  'contentSpecificationIds', 'registrantIdentity', 'manufacturerIdentification', 'manufacturerPostalAddress',
  'manufacturerContactDetails', 'batteryCategory', 'batteryIdentification', 'manufacturingPlace', 'manufacturingDate',
  'batteryWeight', 'batteryChemistry', 'criticalRawMaterials', 'hazardousSubstances', 'euDeclarationOfConformity']);

export function toSchemaOrg(p, terms, profile, langs = ['en']) {
  const d = describe(p, profile, terms, langs);
  const out = { '@context': 'https://schema.org/', '@type': 'Product' };
  if (p.uniqueProductIdentifier) out['@id'] = p.uniqueProductIdentifier;
  out.name = d.title;
  if (p.batteryCategory) { out.category = codeLabel(p.batteryCategory, terms); out.additionalType = p.batteryCategory; }
  const id = p.batteryIdentification || {};
  if (id.modelIdentifier) out.model = id.modelIdentifier;
  if (id.serialNumber) out.serialNumber = id.serialNumber;
  if (id.productNumber) out.productID = id.productNumber;
  if (id.batchNumber) out.identifier = { '@type': 'PropertyValue', propertyID: 'batch', value: id.batchNumber };
  const mi = p.manufacturerIdentification || {}, mc = p.manufacturerContactDetails || {};
  if (mi.manufacturerName || p.manufacturerPostalAddress || mc.manufacturerWebsite) {
    out.manufacturer = { '@type': 'Organization' };
    if (mi.manufacturerName) out.manufacturer.name = mi.manufacturerName;
    if (p.manufacturerPostalAddress) out.manufacturer.address = { '@type': 'PostalAddress', streetAddress: p.manufacturerPostalAddress };
    if (mc.manufacturerWebsite) out.manufacturer.url = mc.manufacturerWebsite;
    if (mc.manufacturerEmail) out.manufacturer.email = String(mc.manufacturerEmail).replace(/^mailto:/, '');
  }
  if (mi.manufacturerTradeName || mi.manufacturerTrademark) out.brand = { '@type': 'Brand', name: mi.manufacturerTradeName || mi.manufacturerTrademark };
  const place = p.manufacturingPlace || {};
  if (place.manufacturingCountry) out.countryOfOrigin = { '@type': 'Country', name: countryName(place.manufacturingCountry, langs), identifier: place.manufacturingCountry };
  if (place.manufacturingCity) out.countryOfAssembly = [place.manufacturingCity, place.manufacturingRegion, countryName(place.manufacturingCountry || '', langs)].filter(Boolean).join(', ');
  if (p.manufacturingDate) out.productionDate = p.manufacturingDate;
  if (p.batteryWeight) out.weight = qv(p.batteryWeight, terms);
  const materials = [...(p.batteryChemistry || []), ...(p.criticalRawMaterials || [])].map((c) => codeLabel(c, terms));
  if (materials.length) out.material = materials;
  if (p.hazardousSubstances?.length) out.substanceOfConcern = p.hazardousSubstances.map((s) => ({ '@type': 'DefinedTerm', name: s }));
  const extra = [];
  for (const [k, v] of Object.entries(p)) {
    if (DIRECT.has(k) || v == null) continue;
    const kind = classify(k, v, terms), iri = fieldOf(terms, k)?.iri;
    const pv = { '@type': 'PropertyValue', name: fieldLabel(k, terms) };
    if (iri) pv.propertyID = iri;
    if (kind === 'quantity') Object.assign(pv, (({ '@type': _, ...rest }) => rest)(qv(v, terms)));
    else if (kind === 'number' || kind === 'boolean') pv.value = v;
    else if (kind === 'langtext') pv.value = text(v, langs);
    else pv.value = textOf(k, v, terms, langs);
    if (pv.value !== '' && pv.value != null) extra.push(pv);
  }
  if (extra.length) out.additionalProperty = extra;
  if (p.euDeclarationOfConformity) {
    const doc = p.euDeclarationOfConformity;
    out.subjectOf = [{ '@type': 'DeclarationOfConformity', name: doc.resourceTitle || 'EU declaration of conformity', url: doc.url,
      ...(doc.contentType ? { encodingFormat: doc.contentType } : {}), ...(doc.language ? { inLanguage: doc.language } : {}) }];
  }
  if (p.digitalProductPassportId) {
    out.hasDigitalProductPassport = { '@type': 'DigitalProductPassport', '@id': p.digitalProductPassportId, url: p.digitalProductPassportId };
    if (p.lastUpdate) out.hasDigitalProductPassport.dateModified = p.lastUpdate;
    if (p.dppStatus) out.hasDigitalProductPassport.creativeWorkStatus = codeLabel(p.dppStatus, terms);
    if (p.contentSpecificationIds?.length) out.hasDigitalProductPassport.isBasedOn = p.contentSpecificationIds;
  }
  return out;
}

// for SPARQL: the same, with a context that needs no network
export const OFFLINE_CONTEXT = { '@vocab': 'https://schema.org/', additionalType: { '@type': '@id' }, url: { '@type': '@id' },
  isBasedOn: { '@type': '@id' }, propertyID: { '@type': '@id' } };
