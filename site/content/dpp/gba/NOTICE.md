# Global Battery Alliance pilot passports (as published)

These 21 records come from the public battery passport pilot pages of the
Global Battery Alliance (2023 proof-of-concept, 2024 MVP and 2026 operational-trial
pilots), retrieved on 2026-11-04. Each entry in `index.json` links to its original page.

- `index.json` → `raw`: the values as shown on the GBA page, under the GBA's own field names.
- `ec/*.json`: the same values placed into EC DPP fields (release 1.0.0) where the EC
  model has a place for them. Values that have no EC field (energy, energy density,
  cell counts, traceability and ESG scores) stay in `raw` only.

The GBA pages state no licence. The data were published openly to show what battery
passports can contain. These pilots were not made to the EC format, so they fail the
EC checker; the problems show which EC fields they don't yet carry.
Figures are as published by the pilot participants; see the original pages for their
disclaimers.
