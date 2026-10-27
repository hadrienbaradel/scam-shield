// Same-origin JSON calls with the session cookie, and the live event stream.

export class ApiError extends Error {
  constructor(status, data) { super(data?.message || data?.error || `Request failed (${status})`); this.status = status; this.data = data; }
}

export async function api(path, { method = "GET", body, form } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Live events. After a dropped connection, onReconnect refetches what may
// have changed meanwhile (no event is replayed by the server).
export function events(handlers, onReconnect) {
  const es = new EventSource("/api/events");
  let dropped = false;
  es.addEventListener("error", () => { dropped = true; });
  es.addEventListener("open", () => { if (dropped) { dropped = false; onReconnect?.(); } });
  for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (e) => fn(JSON.parse(e.data || "{}")));
  return es;
}
