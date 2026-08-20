import { open } from "node:fs/promises";

export interface PngMetadata { width: number; height: number; format: "png"; alpha: boolean }

export async function readPngMetadata(file: string): Promise<PngMetadata> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(26);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 26 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("File is not a valid PNG");
    const colorType = buffer[25]!;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png", alpha: colorType === 4 || colorType === 6 };
  } finally { await handle.close(); }
}
