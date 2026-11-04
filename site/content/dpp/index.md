---
title: Digital Product Passports - MarketyMarks
layout: base.njk
---

<div class="content">

## Digital Product Passports

Open, checkable tools for the EU Digital Product Passport (DPP), built from the
European Commission's own published files. Batteries come first: their
passport is mandatory from **18 February 2027**.

- **[DPP Checker](check/)**: paste or drop a passport (EC JSON) and see whether
  it meets the EC's rules, with each problem explained in the EC's own words.
  It runs in the browser and nothing is uploaded.
- **EC files**: an unmodified copy of the EC's DPP semantic data artifacts,
  [release 1.0.0](ec/1.0.0/NOTICE.md) (contexts, rules, codelists, sample
  passports), kept here because the EC's own addresses for them don't resolve yet.

### Who it's for

Manufacturers and importers preparing passports, DPP software vendors who want
an independent check, market surveillance authorities and notified bodies,
and anyone working on DPP standards.

### How to judge it

- Every EC sample passport must pass, and a set of deliberately broken
  passports must fail. The checker page has a **self-test** button that runs
  these in your browser.
- Results can be compared with other validators of the same EC files.
- It is built on [Factoidal](https://www.npmjs.com/package/@factoidal/core),
  whose core is written and checked in Lean. Factoidal is still experimental
  and unreviewed, and two known gaps in it are worked around in the checker,
  which says so.

### Coming next

- Mappings from the EC model to other DPP models: CIRPASS-2's EU DPP core
  ontology, the Battery Pass / Catena-X models, UNTP and the DPPO ontology.
- The access-token check that a manufacturer's own passport server must run
  for the EC registry, and a mock registry for testing.
- The EC codelists will also be searchable in [skosdex](https://skosdex.org/).

This is not an official EC service.

</div>
