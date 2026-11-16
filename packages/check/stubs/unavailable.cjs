// Stands in for server-only libraries (databases, tracing exporters, cloud SDKs) that shared code
// imports at load time but the free check service never uses. Loading works; using it says so.
'use strict';
function unavailable() {
  throw new Error('This library is not included in the free Mastyf check service.');
}
const handler = {
  get(_target, prop) {
    if (prop === '__esModule') return false;
    if (prop === 'then') return undefined; // not a promise
    if (prop === Symbol.toPrimitive) return () => 'unavailable';
    return thing;
  },
  apply: unavailable,
  construct: unavailable,
};
const thing = new Proxy(function () {}, handler);
module.exports = thing;
