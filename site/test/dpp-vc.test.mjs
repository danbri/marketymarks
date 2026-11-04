// Signed passports: sign an EC passport as a VC (eddsa-rdfc-2022, did:key), verify it, detect
// tampering, and check the signature independently with node:crypto Ed25519.
import * as F from '@factoidal/core';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { Checker } from '../content/dpp/lib/dpp-check.mjs';
import { PassportCredentials, publicKeyFromDidKey } from '../content/dpp/lib/dpp-vc.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const checker = new Checker(F, (p) => read('../content/dpp/ec/1.0.0/' + p));
const vc = new PassportCredentials(F, checker, (p) => read('../content/dpp/' + p));
const passport = JSON.parse(await read('../content/dpp/demo/demo-001.json'));
const results = [];
const expect = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} vc ${name}${detail ? ' — ' + detail : ''}`); };

const key = await vc.newKey();
const signed = await vc.sign(passport, key);
expect('signed credential has a proof and keeps the EC passport as subject', signed.proof?.proofValue?.startsWith('z') && signed.credentialSubject.batteryCapacity.value === 230);
const v = await vc.verify(signed);
expect('verifies', v.verified && v.issuer === key.did, JSON.stringify(v));
const roundTrip = await vc.verify(JSON.parse(JSON.stringify(signed)));
expect('verifies after a JSON round trip', roundTrip.verified);
const tampered = structuredClone(signed); tampered.credentialSubject.batteryCapacity.value = 999;
expect('a changed value fails', !(await vc.verify(tampered)).verified);
const added = structuredClone(signed); added.credentialSubject.batteryWeight.value = 1;
expect('a changed nested value fails', !(await vc.verify(added)).verified);
const other = await vc.newKey();
const swapped = structuredClone(signed); swapped.issuer = other.did; swapped.proof.verificationMethod = other.verificationMethod;
expect('claiming another issuer fails', !(await vc.verify(swapped)).verified);
const mismatch = structuredClone(signed); mismatch.issuer = other.did;
expect('a key that is not the issuer\'s fails', /not the issuer/.test((await vc.verify(mismatch)).reason || ''));
const reordered = { proof: signed.proof, credentialSubject: Object.fromEntries(Object.entries(signed.credentialSubject).reverse()), validFrom: signed.validFrom, issuer: signed.issuer, type: signed.type, '@context': signed['@context'] };
expect('key order does not matter (RDF canonicalization)', (await vc.verify(reordered)).verified);

// independent check: eddsa-rdfc-2022 signs SHA-256(canonical proof config) || SHA-256(canonical document)
const { proofValue, ...cfg } = signed.proof; const { proof, ...cred } = signed;
const c = await vc.canonical(cred, cfg);
const hashData = Buffer.concat([createHash('sha256').update(c.cfg).digest(), createHash('sha256').update(c.doc).digest()]);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let x = 0n; for (const ch of proofValue.slice(1)) x = x * 58n + BigInt(B58.indexOf(ch));
const sig = Buffer.from(x.toString(16).padStart(128, '0'), 'hex');
const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyFromDidKey(signed.proof.verificationMethod), 'hex')]), format: 'der', type: 'spki' });
expect('signature verifies with node:crypto (independent of the engine)', nodeVerify(null, hashData, pub, sig));

const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} vc failure(s)` : `vc: all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
