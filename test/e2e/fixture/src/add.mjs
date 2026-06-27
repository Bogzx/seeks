// seeks e2e oracle: this function is intentionally UNIMPLEMENTED.
// The done-condition is `npm test` → exit 0. The loop's maker must implement
// `add` so the test below passes; the verifier subagent then certifies on green.
export function add(a, b) {
  throw new Error('not implemented');
}
