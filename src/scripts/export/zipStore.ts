/** Minimal ZIP writer using uncompressed (STORE) entries and no dependencies. */
const encoder = new TextEncoder()
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(view: DataView, at: number, value: number) { view.setUint16(at, value, true) }
function u32(view: DataView, at: number, value: number) { view.setUint32(at, value, true) }

export type ZipEntry = { name: string; data: Blob | Uint8Array | ArrayBuffer | string }

export async function createStoreZip(entries: ZipEntry[]) {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/^\/+/, ""))
    const data = typeof entry.data === "string" ? encoder.encode(entry.data)
      : entry.data instanceof Blob ? new Uint8Array(await entry.data.arrayBuffer())
      : entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data)
    const crc = crc32(data)
    const header = new Uint8Array(30 + name.length); const h = new DataView(header.buffer)
    u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 8, 0)
    u32(h, 14, crc); u32(h, 18, data.length); u32(h, 22, data.length); u16(h, 26, name.length)
    header.set(name, 30); local.push(header, data)
    const dir = new Uint8Array(46 + name.length); const d = new DataView(dir.buffer)
    u32(d, 0, 0x02014b50); u16(d, 4, 20); u16(d, 6, 20); u16(d, 8, 0x0800); u16(d, 10, 0)
    u32(d, 16, crc); u32(d, 20, data.length); u32(d, 24, data.length); u16(d, 28, name.length); u32(d, 42, offset)
    dir.set(name, 46); central.push(dir); offset += header.length + data.length
  }
  const dirSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22); const e = new DataView(end.buffer)
  u32(e, 0, 0x06054b50); u16(e, 8, entries.length); u16(e, 10, entries.length)
  u32(e, 12, dirSize); u32(e, 16, offset)
  return new Blob([...local, ...central, end], { type: "application/zip" })
}
