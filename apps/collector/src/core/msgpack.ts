/**
 * MessagePack, enough for socket.io-msgpack-parser (which uses notepack.io):
 * nil, booleans, ints, floats, strings, binary, arrays, maps, and the two
 * extensions notepack emits: fixext 1 type 0 for `undefined` and the
 * timestamp extension (-1) for Dates. Decoded `undefined` becomes null and
 * Dates become ISO strings so payloads stay plain JSON for raw_events.
 */

export function encode(value: unknown): Buffer {
  const parts: Buffer[] = [];
  const push = (b: Buffer) => parts.push(b);
  const u8 = (n: number) => push(Buffer.from([n]));
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return u8(0xc0);
    if (v === true) return u8(0xc3);
    if (v === false) return u8(0xc2);
    if (typeof v === "number") {
      if (Number.isInteger(v)) {
        if (v >= 0 && v < 128) return u8(v);
        if (v < 0 && v >= -32) return u8(0x100 + v);
        if (v >= 0 && v <= 0xff) return push(Buffer.from([0xcc, v]));
        if (v >= 0 && v <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xcd; b.writeUInt16BE(v, 1); return push(b); }
        if (v >= 0 && v <= 0xffffffff) { const b = Buffer.alloc(5); b[0] = 0xce; b.writeUInt32BE(v, 1); return push(b); }
        if (v < 0 && v >= -128) { const b = Buffer.alloc(2); b[0] = 0xd0; b.writeInt8(v, 1); return push(b); }
        if (v < 0 && v >= -32768) { const b = Buffer.alloc(3); b[0] = 0xd1; b.writeInt16BE(v, 1); return push(b); }
        if (v < 0 && v >= -2147483648) { const b = Buffer.alloc(5); b[0] = 0xd2; b.writeInt32BE(v, 1); return push(b); }
      }
      const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(v, 1); return push(b);
    }
    if (typeof v === "string") {
      const s = Buffer.from(v, "utf8");
      if (s.length < 32) u8(0xa0 | s.length);
      else if (s.length <= 0xff) push(Buffer.from([0xd9, s.length]));
      else if (s.length <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xda; b.writeUInt16BE(s.length, 1); push(b); }
      else { const b = Buffer.alloc(5); b[0] = 0xdb; b.writeUInt32BE(s.length, 1); push(b); }
      return push(s);
    }
    if (Buffer.isBuffer(v)) {
      if (v.length <= 0xff) push(Buffer.from([0xc4, v.length]));
      else if (v.length <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xc5; b.writeUInt16BE(v.length, 1); push(b); }
      else { const b = Buffer.alloc(5); b[0] = 0xc6; b.writeUInt32BE(v.length, 1); push(b); }
      return push(v);
    }
    if (Array.isArray(v)) {
      if (v.length < 16) u8(0x90 | v.length);
      else if (v.length <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xdc; b.writeUInt16BE(v.length, 1); push(b); }
      else { const b = Buffer.alloc(5); b[0] = 0xdd; b.writeUInt32BE(v.length, 1); push(b); }
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      if (entries.length < 16) u8(0x80 | entries.length);
      else if (entries.length <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xde; b.writeUInt16BE(entries.length, 1); push(b); }
      else { const b = Buffer.alloc(5); b[0] = 0xdf; b.writeUInt32BE(entries.length, 1); push(b); }
      for (const [k, x] of entries) { walk(k); walk(x); }
      return;
    }
    throw new Error(`msgpack: cannot encode ${typeof v}`);
  };
  walk(value);
  return Buffer.concat(parts);
}

export function decode(buf: Buffer): unknown {
  let i = 0;
  const ext = (type: number, data: Buffer): unknown => {
    if (type === 0) return null; // notepack: undefined
    if (type === -1 || type === 255) {
      // msgpack timestamp extension
      if (data.length === 4) return new Date(data.readUInt32BE(0) * 1000).toISOString();
      if (data.length === 8) { const hi = data.readUInt32BE(0); const lo = data.readUInt32BE(4); const sec = (hi & 0x3) * 2 ** 32 + lo; const ns = hi >>> 2; return new Date(sec * 1000 + ns / 1e6).toISOString(); }
      if (data.length === 12) { const ns = data.readUInt32BE(0); const sec = Number(data.readBigInt64BE(4)); return new Date(sec * 1000 + ns / 1e6).toISOString(); }
    }
    return { ext: type, data: data.toString("base64") };
  };
  const read = (): unknown => {
    const t = buf[i++];
    if (t <= 0x7f) return t;
    if (t >= 0xe0) return t - 0x100;
    if (t >= 0x80 && t <= 0x8f) return map(t & 0x0f);
    if (t >= 0x90 && t <= 0x9f) return arr(t & 0x0f);
    if (t >= 0xa0 && t <= 0xbf) return str(t & 0x1f);
    switch (t) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(buf[i++]);
      case 0xc5: { const n = buf.readUInt16BE(i); i += 2; return bin(n); }
      case 0xc6: { const n = buf.readUInt32BE(i); i += 4; return bin(n); }
      case 0xc7: { const n = buf[i++]; const type = buf.readInt8(i++); return ext(type, take(n)); }
      case 0xc8: { const n = buf.readUInt16BE(i); i += 2; const type = buf.readInt8(i++); return ext(type, take(n)); }
      case 0xc9: { const n = buf.readUInt32BE(i); i += 4; const type = buf.readInt8(i++); return ext(type, take(n)); }
      case 0xca: { const v = buf.readFloatBE(i); i += 4; return v; }
      case 0xcb: { const v = buf.readDoubleBE(i); i += 8; return v; }
      case 0xcc: return buf[i++];
      case 0xcd: { const v = buf.readUInt16BE(i); i += 2; return v; }
      case 0xce: { const v = buf.readUInt32BE(i); i += 4; return v; }
      case 0xcf: { const v = buf.readBigUInt64BE(i); i += 8; return Number(v); }
      case 0xd0: { const v = buf.readInt8(i); i += 1; return v; }
      case 0xd1: { const v = buf.readInt16BE(i); i += 2; return v; }
      case 0xd2: { const v = buf.readInt32BE(i); i += 4; return v; }
      case 0xd3: { const v = buf.readBigInt64BE(i); i += 8; return Number(v); }
      case 0xd4: { const type = buf.readInt8(i++); return ext(type, take(1)); }
      case 0xd5: { const type = buf.readInt8(i++); return ext(type, take(2)); }
      case 0xd6: { const type = buf.readInt8(i++); return ext(type, take(4)); }
      case 0xd7: { const type = buf.readInt8(i++); return ext(type, take(8)); }
      case 0xd8: { const type = buf.readInt8(i++); return ext(type, take(16)); }
      case 0xd9: return str(buf[i++]);
      case 0xda: { const n = buf.readUInt16BE(i); i += 2; return str(n); }
      case 0xdb: { const n = buf.readUInt32BE(i); i += 4; return str(n); }
      case 0xdc: { const n = buf.readUInt16BE(i); i += 2; return arr(n); }
      case 0xdd: { const n = buf.readUInt32BE(i); i += 4; return arr(n); }
      case 0xde: { const n = buf.readUInt16BE(i); i += 2; return map(n); }
      case 0xdf: { const n = buf.readUInt32BE(i); i += 4; return map(n); }
    }
    throw new Error(`msgpack: unsupported type 0x${t.toString(16)} at ${i - 1}`);
  };
  const take = (n: number) => { const b = buf.subarray(i, i + n); i += n; return b; };
  const str = (n: number) => take(n).toString("utf8");
  const bin = (n: number) => ({ bin: take(n).toString("base64") });
  const arr = (n: number) => { const out: unknown[] = []; for (let k = 0; k < n; k++) out.push(read()); return out; };
  const map = (n: number) => { const out: Record<string, unknown> = {}; for (let k = 0; k < n; k++) { const key = read(); out[String(key)] = read(); } return out; };
  return read();
}
