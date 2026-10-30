// The developer's own computer: not production, a browser on this machine
// (loopback address), no forwarding header and a Host naming this machine.
// It guards /dev/outbox (its copies hold live one-tap links) and /dev/signin
// (it signs people in without Google).
//
// Why: with trustProxy off, request.ip is the socket's address, and a tunnel
// or a local reverse proxy connects from 127.0.0.1 too, so a request carrying
// a forwarding header is refused (cloudflared, ngrok and Caddy add one by
// default, nginx when configured to; Via names a proxy on the way), and so is
// one whose Host is not this machine's name, or that has no Host: through a
// tunnel or a raw forward such as ssh -R the Host is the public name, and a
// DNS-rebinding page sends its own. What still gets through is a request
// reaching the loopback with Host localhost and no forwarding header: a proxy
// that rewrites Host to localhost, an SSH local forward from another machine.
// These pages are for testing on one machine, never behind a tunnel or a
// proxy.

import { config } from "./config.js";

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const FORWARDING_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip", "x-real-ip", "forwarded", "via"];
const LOCAL_NAMES = ["localhost", "127.0.0.1", "[::1]"];

// The Host header's name without its port ("[::1]:3000" is "[::1]"); "" without one.
const hostName = (host = "") => {
  const h = String(host).toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
};

export function isLocalDevRequest(request) {
  return !config.production
    && LOOPBACK.includes(request.ip)
    && !FORWARDING_HEADERS.some((h) => request.headers[h] !== undefined)
    && LOCAL_NAMES.includes(hostName(request.headers.host));
}
