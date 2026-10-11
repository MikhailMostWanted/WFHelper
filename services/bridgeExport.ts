import type { AccountBridgeDocument } from "./accountBridge";
import { accountGuide } from "./accountBridge";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data: Buffer): number {
  let n = 0xffffffff;
  for (const byte of data) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
/** Two fixed filenames, ordinary ZIP store method; no user paths or hidden credentials. */
export function bridgeExportZip(doc: AccountBridgeDocument): Buffer {
  const entries = [["account.json", JSON.stringify(doc)], ["README_CHATGPT.md", accountGuide(doc)]];
  const local: Buffer[] = []; const directory: Buffer[] = []; let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename); const body = Buffer.from(text, "utf8"); const crc = crc32(body);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(33, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18); head.writeUInt32LE(body.length, 22); head.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    local.push(head, name, body); directory.push(central, name); offset += head.length + name.length + body.length;
  }
  const central = Buffer.concat(directory); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
