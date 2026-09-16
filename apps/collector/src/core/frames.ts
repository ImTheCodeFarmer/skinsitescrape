/** Parse a socket.io v4 text frame. Returns null for control frames. */
export function parseSocketIoFrame(s: string): { event: string; args: unknown[] } | null {
  // "42[...]" = engine.io MESSAGE (4) + socket.io EVENT (2); may carry a namespace ("42/ns,[...]") or ack id ("4212[...]")
  if (!s.startsWith("42")) return null;
  const start = s.indexOf("[");
  if (start < 0) return null;
  try {
    const arr = JSON.parse(s.slice(start));
    if (!Array.isArray(arr) || typeof arr[0] !== "string") return null;
    return { event: arr[0], args: arr.slice(1) };
  } catch {
    return null;
  }
}

/**
 * Parse a raw `[id, event, data]` frame (csgogem's protocol). Server pushes
 * carry id -1; replies to our requests carry the id we sent, with `event`
 * null on success or an error name ("MalformedRequest") on failure. Replies
 * are surfaced as event "ack" (or the error name) with args [data, id].
 */
export function parseRawFrame(s: string): { event: string; args: unknown[] } | null {
  if (!s.startsWith("[")) return null;
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const [id, ev, data] = arr as [number, string | null, unknown];
    const event = typeof ev === "string" ? ev : "ack";
    return typeof id === "number" && id >= 1 ? { event, args: [data, id] } : { event, args: data === undefined ? [] : [data] };
  } catch {
    return null;
  }
}

/**
 * Parse a `[event, data]` frame (cases.gg). Both sockets there send exactly
 * two elements: the event name and one payload, with no request ids or acks.
 */
export function parsePairFrame(s: string): { event: string; args: unknown[] } | null {
  if (!s.startsWith("[")) return null;
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr) || typeof arr[0] !== "string") return null;
    return { event: arr[0], args: arr.length > 1 ? [arr[1]] : [] };
  } catch {
    return null;
  }
}
