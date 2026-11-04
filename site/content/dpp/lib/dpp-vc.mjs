// dpp-vc: a Digital Product Passport as a W3C Verifiable Credential (VCDM 2.0), signed with
// the Data Integrity cryptosuite eddsa-rdfc-2022 (RDF Dataset Canonicalization 1.0 + Ed25519)
// and a did:key issuer. The EC JSON stays as it is: it becomes the credentialSubject, with the
// EC JSON-LD context attached, so the same data the Registry validates is what gets signed.
//
//   const vc = new PassportCredentials(F, checker, loadText);   // F = @factoidal/core
//   const key = await vc.newKey();
//   const signed = await vc.sign(passport, key);
//   const result = await vc.verify(signed);   // { verified, issuer, reason }

import { detectProfile } from './dpp-check.mjs';

const V2 = 'https://www.w3.org/ns/credentials/v2';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
function b58enc(bytes) {
  let x = BigInt('0x' + (bytesToHex(bytes) || '0')), s = '';
  while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(s) {
  let x = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error('not base58'); x = x * 58n + BigInt(i); }
  let h = x.toString(16); if (h.length % 2) h = '0' + h;
  const lead = s.match(/^1*/)[0].length;
  return Uint8Array.from([...new Array(lead).fill(0), ...(x > 0n ? hexToBytes(h) : [])]);
}
// did:key for an Ed25519 public key: multicodec 0xed01 + key, base58btc multibase 'z'
export const didKeyFor = (publicKeyHex) => {
  const mb = 'z' + b58enc(Uint8Array.from([0xed, 0x01, ...hexToBytes(publicKeyHex)]));
  return { did: `did:key:${mb}`, verificationMethod: `did:key:${mb}#${mb}` };
};
export function publicKeyFromDidKey(didOrVm) {
  const m = /^did:key:(z[1-9A-HJ-NP-Za-km-z]+)(?:#(z[1-9A-HJ-NP-Za-km-z]+))?$/.exec(didOrVm);
  if (!m || (m[2] && m[2] !== m[1])) throw new Error('not an Ed25519 did:key verification method');
  const bytes = b58dec(m[1].slice(1));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('did:key is not an Ed25519 key');
  return bytesToHex(bytes.slice(2));
}

export class PassportCredentials {
  // load(path) reads files relative to this module's folder's parent (dpp/), e.g. 'vc/credentials-v2.jsonld'
  constructor(F, checker, load) { this.F = F; this.checker = checker; this.load = load; }
  async v2() { return (this._v2 ??= this.load('vc/credentials-v2.jsonld')); }
  // replace the remote v2 context IRI with the vendored copy (the engine does not fetch contexts)
  async inline(doc) {
    const v2 = JSON.parse(await this.v2())['@context'];
    const swap = (c) => (c === V2 ? v2 : c);
    return { ...doc, '@context': Array.isArray(doc['@context']) ? doc['@context'].map(swap) : swap(doc['@context']) };
  }
  async newKey() {
    const sk = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const pk = await this.F.vcEd25519SecretToPublic(sk);
    return { secretKeyHex: sk, publicKeyHex: pk, ...didKeyFor(pk) };
  }
  async credentialFor(passport, issuerDid, { validFrom = new Date().toISOString().replace(/\.\d+Z$/, 'Z') } = {}) {
    const ctx = await this.checker.contextFor(detectProfile(passport));
    const subject = { '@context': ctx, id: passport.uniqueProductIdentifier || passport.digitalProductPassportId, type: 'dpp:DigitalProductPassport', ...passport };
    return { '@context': [V2], type: ['VerifiableCredential'], issuer: issuerDid, validFrom, credentialSubject: subject };
  }
  async canonical(credential, proofConfig) {
    const F = this.F;
    const doc = await (await F.jsonldToRdf(JSON.stringify(await this.inline(credential)))).canonicalize();
    const cfg = await F.canonicalize(JSON.stringify(await this.inline({ '@context': [V2], ...proofConfig })), 'jsonld');
    return { doc, cfg };
  }
  async sign(passport, key, opts = {}) {
    const credential = await this.credentialFor(passport, key.did, opts);
    const proofConfig = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022', created: credential.validFrom,
      verificationMethod: key.verificationMethod, proofPurpose: 'assertionMethod' };
    const { doc, cfg } = await this.canonical(credential, proofConfig);
    const proofValue = await this.F.vcEddsaCreateFromCanonical(key.secretKeyHex, doc, cfg);
    return { ...credential, proof: { ...proofConfig, proofValue } };
  }
  async verify(signed) {
    try {
      const { proof, ...credential } = signed || {};
      if (!proof || proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-rdfc-2022') return { verified: false, reason: 'no eddsa-rdfc-2022 Data Integrity proof' };
      if (proof.proofPurpose !== 'assertionMethod') return { verified: false, reason: 'proofPurpose is not assertionMethod' };
      const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
      if (!String(proof.verificationMethod).startsWith(issuer + '#')) return { verified: false, reason: 'the key is not the issuer\'s' };
      const pk = publicKeyFromDidKey(proof.verificationMethod);
      const { proofValue, ...proofConfig } = proof;
      const { doc, cfg } = await this.canonical(credential, proofConfig);
      const ok = await this.F.vcEddsaVerifyFromCanonical(pk, doc, cfg, proofValue);
      return ok ? { verified: true, issuer } : { verified: false, issuer, reason: 'the signature does not match the content' };
    } catch (e) { return { verified: false, reason: e.message }; }
  }
}
