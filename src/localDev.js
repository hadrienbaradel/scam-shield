// The developer's own computer: not production, a browser on this machine
// (loopback address), no forwarding header and a Host naming this machine,
// since a tunnel or a local proxy connects from 127.0.0.1 too. It guards the
// local outbox and the local sign-in (/dev/outbox and /dev/signin); the
// reasoning is spelled out above /dev/outbox in src/routes/admin.js.

import { config } from "./config.js";

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const FORWARDING_HEADERS = ["x-forwarded-for", "cf-connecting-ip", "x-real-ip", "forwarded"];
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
