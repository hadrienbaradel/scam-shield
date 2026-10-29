// Live updates to open browser tabs (Server-Sent Events): a new verdict,
// a guardian's answer, a sync finishing. In-memory, single process.

const streams = new Map(); // userId -> Set<raw response>

export function subscribe(userId, reply) {
  const raw = reply.raw;
  raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  raw.write("retry: 5000\n\n");
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(raw);
  const ping = setInterval(() => raw.write(": ping\n\n"), 25000);
  raw.on("close", () => {
    clearInterval(ping);
    streams.get(userId)?.delete(raw);
  });
}

export function publish(userId, type, data = {}) {
  for (const raw of streams.get(userId) || []) raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// For the admin console: how many tabs are listening, for how many people.
export function streamStats() {
  let connections = 0;
  let people = 0;
  for (const set of streams.values()) {
    if (!set.size) continue;
    people++;
    connections += set.size;
  }
  return { connections, people };
}
