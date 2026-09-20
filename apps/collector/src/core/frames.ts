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

/**
 * Parse a graphql-transport-ws message (csgoroll). The transport subscribes
 * with the operation name as the message id, so a `next` surfaces as event
 * `<operation>` with args [payload.data]. `error` (a failed subscription)
 * surfaces as "error" with args [errors, id], `complete` as "complete" with
 * args [id]. Control messages (connection_ack, ping, pong) keep their type as
 * the event name and are handled by the transport.
 */
export function parseGraphqlFrame(s: string): { event: string; args: unknown[] } | null {
  if (!s.startsWith("{")) return null;
  try {
    const o = JSON.parse(s) as { type?: string; id?: string; payload?: { data?: unknown; errors?: unknown } | unknown };
    if (typeof o.type !== "string") return null;
    const p = o.payload as { data?: unknown; errors?: unknown } | undefined;
    switch (o.type) {
      case "next":
        if (typeof o.id !== "string") return null;
        return p?.data !== undefined && p?.data !== null ? { event: o.id, args: [p.data] } : { event: "error", args: [p?.errors ?? p, o.id] };
      case "error":
        return { event: "error", args: [o.payload, o.id] };
      case "complete":
        return { event: "complete", args: [o.id] };
      default:
        return { event: o.type, args: o.payload === undefined ? [] : [o.payload] };
    }
  } catch {
    return null;
  }
}

/**
 * Parse an `{"a":[event, ...args]}` frame (bandit.camp). Replies to our
 * requests carry no `a`: `{"i":id, "d":data}` on success, surfaced as event
 * "ack" with args [data, id], or `{"i":id, "e":{message}}` on failure,
 * surfaced as event "nack" with args [error, id].
 */
export function parseEnvelopeFrame(s: string): { event: string; args: unknown[] } | null {
  if (!s.startsWith("{")) return null;
  try {
    const o = JSON.parse(s) as { a?: unknown; i?: number; d?: unknown; e?: unknown };
    if (Array.isArray(o.a) && typeof o.a[0] === "string") return { event: o.a[0], args: o.a.slice(1) };
    if (typeof o.i !== "number") return null;
    return "e" in o ? { event: "nack", args: [o.e, o.i] } : { event: "ack", args: [o.d, o.i] };
  } catch {
    return null;
  }
}

/**
 * Parse a socket.io packet decoded from socket.io-msgpack-parser
 * (rustbattle): `{type, data, nsp, id?}` with the same packet types as the
 * JSON parser. CONNECT (0) surfaces as "connect", EVENT (2) as its event
 * name, ACK (3) as "ack" with the ack id appended, CONNECT_ERROR (4) as
 * "connect_error". Control types (1 disconnect, 5/6 binary) return null.
 */
export function parseMsgpackPacket(o: unknown): { event: string; args: unknown[] } | null {
  if (!o || typeof o !== "object") return null;
  const p = o as { type?: number; data?: unknown; id?: number };
  switch (p.type) {
    case 0:
      return { event: "connect", args: p.data === undefined ? [] : [p.data] };
    case 2:
      return Array.isArray(p.data) && typeof p.data[0] === "string" ? { event: p.data[0], args: p.data.slice(1) } : null;
    case 3:
      return { event: "ack", args: [...(Array.isArray(p.data) ? p.data : [p.data]), p.id] };
    case 4:
      return { event: "connect_error", args: [p.data] };
    default:
      return null;
  }
}
