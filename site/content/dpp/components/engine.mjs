// The RDF engine, served from this site (copied at build time from the npm package
// that the deploy workflow verified with `npm audit signatures`).
let p;
export const loadEngine = () => (p ??= import(new URL('../engine/browser.js', import.meta.url).href));
