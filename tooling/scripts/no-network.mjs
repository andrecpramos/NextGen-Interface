// Poison every way out of the process, then let something run.
//
// Loaded with `--import`, so it is installed before the program's first line:
//
//   node --import ./tooling/scripts/no-network.mjs some-script.mjs
//
// Used by `check-adapter.mjs` to hold ADR-018's strongest claim — *the copied folder does
// not call out* — as a property of **running it**, rather than of grepping it.
//
// Grepping is the wrong instrument here and it took a red herring to see why. The bundle
// contains `typescript`, whose diagnostic messages quote documentation URLs
// (`https://aka.ms/…`, `https://github.com/…`) as ordinary strings in error text. A gate
// that flags URL literals would fail on a compiler's help text while telling you nothing
// about whether a socket was ever opened. What matters is the socket.
//
// Anything that reaches the network throws with a message naming what was attempted, so a
// failure here is a finding rather than a puzzle.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const refuse = (what, target) => {
  throw new Error(
    `NETWORK BLOCKED: ${what} to ${target}. This process is not allowed to reach the ` +
      'network, and something tried. See tooling/scripts/no-network.mjs.',
  );
};

const describe = (args) => {
  const [first] = args;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    const host = first.host ?? first.hostname ?? first.href ?? '?';
    return first.port ? `${host}:${first.port}` : String(host);
  }
  return '?';
};

globalThis.fetch = (...args) => refuse('fetch', describe(args));

net.connect = net.createConnection = (...args) => refuse('net.connect', describe(args));
tls.connect = (...args) => refuse('tls.connect', describe(args));
http.request = http.get = (...args) => refuse('http.request', describe(args));
https.request = https.get = (...args) => refuse('https.request', describe(args));

// Resolution is blocked too: a lookup is an outbound packet, and blocking only the
// connect would let a name resolve and hide half the evidence.
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  dns[key] = (...args) => refuse(`dns.${key}`, describe(args));
  if (dns.promises?.[key]) dns.promises[key] = (...args) => refuse(`dns.${key}`, describe(args));
}
