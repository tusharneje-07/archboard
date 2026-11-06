import { base64ToBytes, bytesToBase64 } from "./base64";

export type HuffmanCompressed = {
  tree: string;
  data: string;
  bitLength: number;
  originalSize: number;
};

type HuffmanNode = {
  frequency: number;
  symbol?: number;
  left?: HuffmanNode;
  right?: HuffmanNode;
};

function buildTree(bytes: Uint8Array) {
  const frequencies = new Uint32Array(256);
  for (const byte of bytes) frequencies[byte] += 1;
  const nodes: HuffmanNode[] = [];
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    if (frequencies[symbol] > 0) nodes.push({ frequency: frequencies[symbol], symbol });
  }
  if (!nodes.length) return null;
  while (nodes.length > 1) {
    nodes.sort((left, right) => left.frequency - right.frequency || (left.symbol ?? 256) - (right.symbol ?? 256));
    const left = nodes.shift()!;
    const right = nodes.shift()!;
    nodes.push({ frequency: left.frequency + right.frequency, left, right });
  }
  return nodes[0];
}

function serializeTree(root: HuffmanNode) {
  const bytes: number[] = [];
  const visit = (node: HuffmanNode) => {
    if (node.symbol !== undefined) {
      bytes.push(1, node.symbol);
      return;
    }
    bytes.push(0);
    visit(node.left!);
    visit(node.right!);
  };
  visit(root);
  return Uint8Array.from(bytes);
}

function deserializeTree(bytes: Uint8Array) {
  let index = 0;
  const readNode = (): HuffmanNode => {
    const marker = bytes[index];
    index += 1;
    if (marker === 1) {
      const symbol = bytes[index];
      index += 1;
      return { frequency: 0, symbol };
    }
    if (marker !== 0) throw new Error("Invalid Huffman tree.");
    const left = readNode();
    const right = readNode();
    return { frequency: 0, left, right };
  };
  return readNode();
}

function buildCodes(root: HuffmanNode) {
  const codes = new Map<number, string>();
  const visit = (node: HuffmanNode, code: string) => {
    if (node.symbol !== undefined) {
      codes.set(node.symbol, code || "0");
      return;
    }
    visit(node.left!, `${code}0`);
    visit(node.right!, `${code}1`);
  };
  visit(root, "");
  return codes;
}

export function huffmanCompress(input: string): HuffmanCompressed {
  const bytes = new TextEncoder().encode(input);
  if (!bytes.length) return { tree: "", data: "", bitLength: 0, originalSize: 0 };
  const root = buildTree(bytes);
  if (!root) return { tree: "", data: "", bitLength: 0, originalSize: 0 };
  const codes = buildCodes(root);
  let bitLength = 0;
  for (const byte of bytes) bitLength += codes.get(byte)!.length;
  const data = new Uint8Array(Math.ceil(bitLength / 8));
  let bitIndex = 0;
  for (const byte of bytes) {
    const code = codes.get(byte)!;
    for (const bit of code) {
      if (bit === "1") data[bitIndex >> 3] |= 1 << (7 - (bitIndex & 7));
      bitIndex += 1;
    }
  }
  return {
    tree: bytesToBase64(serializeTree(root)),
    data: bytesToBase64(data),
    bitLength,
    originalSize: bytes.length,
  };
}

export function huffmanDecompress(compressed: HuffmanCompressed): string {
  if (!compressed.bitLength || !compressed.tree || !compressed.data) return "";
  const treeBytes = base64ToBytes(compressed.tree);
  const dataBytes = base64ToBytes(compressed.data);
  const root = deserializeTree(treeBytes);
  if (root.symbol !== undefined) {
    return new TextDecoder().decode(new Uint8Array(compressed.originalSize).fill(root.symbol));
  }
  const output = new Uint8Array(compressed.originalSize);
  let outputIndex = 0;
  let bitIndex = 0;
  let node = root;
  while (outputIndex < output.length && bitIndex < compressed.bitLength) {
    const bit = (dataBytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    bitIndex += 1;
    node = bit ? node.right! : node.left!;
    if (node.symbol !== undefined) {
      output[outputIndex] = node.symbol;
      outputIndex += 1;
      node = root;
    }
  }
  if (outputIndex !== output.length) throw new Error("Invalid Huffman data.");
  return new TextDecoder().decode(output);
}
