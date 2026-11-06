import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { base64ToBytes, bytesToBase64 } from "./base64";

export type CompressedProject = {
  codec: "deflate";
  data: string;
  originalSize: number;
};

export function deflateCompress(input: string): CompressedProject {
  const bytes = strToU8(input);
  return {
    codec: "deflate",
    data: bytesToBase64(deflateSync(bytes, { level: 9 })),
    originalSize: bytes.length,
  };
}

export function deflateDecompress(compressed: CompressedProject): string {
  return strFromU8(inflateSync(base64ToBytes(compressed.data)));
}
