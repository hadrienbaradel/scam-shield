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

export function events(handlers) {
  const es = new EventSource("/api/events");
  for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (e) => fn(JSON.parse(e.data || "{}")));
  return es;
}
