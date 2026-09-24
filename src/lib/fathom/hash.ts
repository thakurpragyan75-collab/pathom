/** Sync SHA-256. Content-addressed blocks need a stable hash without async WebCrypto. */

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Binary(ascii: string): string {
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const hash: number[] = [];
  const k: number[] = [];
  const composite: Record<number, number> = {};
  let prime = 0;

  for (let candidate = 2; prime < 64; candidate++) {
    if (!composite[candidate]) {
      for (let i = 0; i < 313; i += candidate) composite[i] = candidate;
      hash[prime] = (candidate ** 0.5 * maxWord) | 0;
      k[prime] = (candidate ** (1 / 3) * maxWord) | 0;
      prime++;
    }
  }

  const bitLength = ascii.length * 8;
  let padded = ascii + "\x80";
  while ((padded.length % 64) - 56) padded += "\x00";

  for (let i = 0; i < padded.length; i++) {
    const code = padded.charCodeAt(i);
    words[i >> 2] = (words[i >> 2] ?? 0) | (code << ((3 - (i % 4)) * 8));
  }
  words[words.length] = (bitLength / maxWord) | 0;
  words[words.length] = bitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const old = hash.slice();
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const a = hash[0] ?? 0;
      const e = hash[4] ?? 0;
      const schedule =
        i < 16
          ? (w[i] ?? 0)
          : ((w[i - 16] ?? 0) +
              (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
              (w[i - 7] ?? 0) +
              (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
            0;
      w[i] = schedule;
      const temp1 =
        (hash[7] ?? 0) +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & (hash[5] ?? 0)) ^ (~e & (hash[6] ?? 0))) +
        (k[i] ?? 0) +
        schedule;
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & (hash[1] ?? 0)) ^ (a & (hash[2] ?? 0)) ^ ((hash[1] ?? 0) & (hash[2] ?? 0)));
      hash[7] = hash[6] ?? 0;
      hash[6] = hash[5] ?? 0;
      hash[5] = hash[4] ?? 0;
      hash[4] = ((hash[3] ?? 0) + temp1) | 0;
      hash[3] = hash[2] ?? 0;
      hash[2] = hash[1] ?? 0;
      hash[1] = a;
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = ((hash[i] ?? 0) + (old[i] ?? 0)) | 0;
  }

  let result = "";
  for (let i = 0; i < 8; i++) {
    for (let shift = 3; shift >= 0; shift--) {
      const b = ((hash[i] ?? 0) >> (shift * 8)) & 255;
      result += b.toString(16).padStart(2, "0");
    }
  }
  return result;
}

export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return sha256Binary(bin);
}

export function shortHash(text: string): string {
  return sha256(text).slice(0, 12);
}
