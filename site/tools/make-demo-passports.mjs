// Makes content/dpp/demo/: fictional battery passports (public view) derived from the
// EC 1.0.0 samples, varied so that comparison, search and maps have something to show.
// Every one must pass the checker (see test/dpp-check.test.mjs). All names are invented.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../content/dpp/ec/1.0.0/', import.meta.url));
const outDir = fileURLToPath(new URL('../content/dpp/demo/', import.meta.url));
const EC = 'https://repository.product-passport.ec.europa.eu/';
const sample = async (s) => JSON.parse(await readFile(`${root}product/batteries/subgroup/${s}/1.0.0/tests/conforms/pub-batteries-${s}.json`, 'utf8'));
const cat = (c) => `${EC}product/batteries/vocabs/battery-category#${c}`;
const chem = (c) => `${EC}product/batteries/vocabs/battery-chemistry#${c}`;
const crm = (c) => `${EC}core/vocabs/critical-raw-material#${c}`;
const q = (unit, value) => ({ unit: `${EC}core/vocabs/measurement-unit#${unit}`, value });
const DEMOS = [
  { id: 'demo-001', sub: 'evb', maker: 'Nordvik Cell AB', trade: 'Nordvik', model: 'NV-82 NMC', place: ['Skellefteå', 'Västerbotten', 'SWE'], lang: 'sv-SE',
    chem: 'lithiumIonNMC', crm: ['lithium', 'cobalt', 'nickelBatteryGrade', 'manganese', 'graphite'], cap: 230, kg: 480, v: 400, cycles: 2000, renew: 18.5, date: '2026-09' },
  { id: 'demo-002', sub: 'evb', maker: 'Wisła Energy Sp. z o.o.', trade: 'WislaCell', model: 'WE-60 LFP', place: ['Wrocław', 'Dolnośląskie', 'POL'], lang: 'pl-PL',
    chem: 'lithiumIonLFP', crm: ['lithium', 'graphite', 'phosphateRock'], cap: 180, kg: 410, v: 355, cycles: 4000, renew: 9, date: '2026-07' },
  { id: 'demo-003', sub: 'evb', maker: 'Rhône Batteries SAS', trade: 'RhôneVolt', model: 'RV-95 NCA', place: ['Lyon', 'Auvergne-Rhône-Alpes', 'FRA'], lang: 'fr-FR',
    chem: 'lithiumIonNCA', crm: ['lithium', 'cobalt', 'nickelBatteryGrade', 'graphite'], cap: 250, kg: 520, v: 400, cycles: 1500, renew: 22, date: '2026-10' },
  { id: 'demo-004', sub: 'lmt', category: 'lightMeansOfTransportBattery', maker: 'Velocità Moto S.r.l.', trade: 'Velocità', model: 'VM-1.2 E-bike', place: ['Turin', 'Piemonte', 'ITA'], lang: 'it-IT',
    chem: 'lithiumIonNMC', crm: ['lithium', 'cobalt', 'nickelBatteryGrade'], cap: 14, kg: 3.2, v: 36, cycles: 1000, renew: 5, date: '2026-05' },
  { id: 'demo-005', sub: 'lmt', category: 'lightMeansOfTransportBattery', maker: 'Porto Mobilidade Lda', trade: 'PortoGo', model: 'PG-48 Scooter', place: ['Porto', 'Norte', 'PRT'], lang: 'pt-PT',
    chem: 'lithiumIonLFP', crm: ['lithium', 'graphite'], cap: 30, kg: 9.5, v: 48, cycles: 2500, renew: 12, date: '2026-06' },
  { id: 'demo-006', sub: 'ind', maker: 'Elbe Speicher GmbH', trade: 'ElbeStore', model: 'ES-200 Rack', place: ['Dresden', 'Sachsen', 'DEU'], lang: 'de-DE', category: 'industrialBattery',
    chem: 'lithiumIonLFP', crm: ['lithium', 'graphite', 'phosphateRock'], cap: 280, kg: 1150, v: 768, cycles: 6000, renew: 15, date: '2026-04' },
  { id: 'demo-007', sub: 'ind', maker: 'Danubius Storage Kft.', trade: 'Danubius', model: 'DS-SI 120 Sodium', place: ['Győr', 'Győr-Moson-Sopron', 'HUN'], lang: 'hu-HU', category: 'industrialBattery',
    chem: 'sodiumIon', crm: ['manganese'], cap: 160, kg: 900, v: 512, cycles: 5000, renew: 30, date: '2026-08' },
  { id: 'demo-008', sub: 'ind', maker: 'Atlantic Grid Ltd', trade: 'AtlanticGrid', model: 'AG-Pb 12', place: ['Cork', 'Munster', 'IRL'], lang: 'en-IE', category: 'industrialBattery',
    chem: 'leadAcid', crm: ['antimony'], cap: 100, kg: 62, v: 12, cycles: 800, renew: 40, date: '2026-02', lead: true },
];
await mkdir(outDir, { recursive: true });
const index = [];
for (const d of DEMOS) {
  const p = structuredClone(await sample(d.sub));
  p.digitalProductPassportId = `https://www.example.org/dpp/${d.id}`;
  p.uniqueProductIdentifier = `https://www.example.org/${d.id}`;
  p.lastUpdate = `${d.date}-15T09:00:00Z`;
  p.manufacturerIdentification = { manufacturerName: `${d.maker} (fictional)`, manufacturerTradeName: d.trade, manufacturerTrademark: `${d.trade}(R)` };
  p.manufacturerPostalAddress = `${d.place[0]}, ${d.place[2]} (fictional address)`;
  p.manufacturingPlace = { manufacturingCity: d.place[0], manufacturingRegion: d.place[1], manufacturingCountry: d.place[2] };
  p.manufacturingDate = d.date;
  p.batteryIdentification = { ...p.batteryIdentification, modelIdentifier: d.model, batchNumber: `${d.id.toUpperCase()}-B1` };
  if (d.category) p.batteryCategory = cat(d.category);
  p.batteryChemistry = [chem(d.chem)];
  p.criticalRawMaterials = d.crm.map(crm);
  p.batteryCapacity = q('ampereHour', d.cap);
  p.batteryWeight = q('kilogram', d.kg);
  if (p.nominalVoltage) p.nominalVoltage = { ...p.nominalVoltage, value: d.v };
  p.expectedLifetimeCycles = d.cycles;
  if (p.renewableContentShare) p.renewableContentShare = q('percent', d.renew);
  if (d.lead) { p.chemicalSymbol = [`${EC}product/batteries/vocabs/battery-chemical-symbol#leadSymbol`]; p.hazardousSubstances = ['Lead', 'Sulphuric acid']; }
  else if (p.chemicalSymbol) p.chemicalSymbol = [`${EC}product/batteries/vocabs/battery-chemical-symbol#noneSymbol`];
  // add the maker's own language alongside English for multilingual fields
  const local = { 'sv-SE': 'Stora mängder vatten', 'pl-PL': 'Duże ilości wody', 'fr-FR': "Grandes quantités d'eau", 'it-IT': "Grandi quantità d'acqua",
    'pt-PT': 'Grandes quantidades de água', 'de-DE': 'Große Mengen Wasser', 'hu-HU': 'Nagy mennyiségű víz', 'en-IE': 'Large quantities of water' }[d.lang];
  if (p.extinguishingAgent) p.extinguishingAgent = { 'en-IE': 'Large quantities of water; dry chemical powder (Class D) for small fires', [d.lang]: local };
  const file = `${d.id}.json`;
  await writeFile(outDir + file, JSON.stringify(p, null, 2) + '\n');
  index.push(file);
}
await writeFile(outDir + 'index.json', JSON.stringify(index, null, 1) + '\n');
console.log(`demo passports: ${index.length} -> content/dpp/demo/`);
