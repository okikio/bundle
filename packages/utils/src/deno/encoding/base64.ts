// Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

import { validateBinaryLike } from "./_util.ts";

/**
 * Utilities for
 * [base64]{@link https://datatracker.ietf.org/doc/html/rfc4648#section-4}
 * encoding and decoding.
 *
 * This module is browser compatible.
 *
 * @module
 */

const base64abc = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "+",
  "/",
];

/**
 * CREDIT: https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
 * Encodes a given Uint8Array, ArrayBuffer or string into RFC4648 base64 representation
 *
 * @deprecated (will be removed in 0.210.0) Use {@linkcode encodeBase64} instead.
 */
export const encode: typeof encodeBase64 = encodeBase64;

/**
 * Decodes a given RFC4648 base64 encoded string
 *
 * @deprecated (will be removed in 0.210.0) Use {@linkcode decodeBase64} instead.
 */
export const decode: typeof decodeBase64 = decodeBase64;

/**
 * Converts data into a base64-encoded string.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc4648#section-4}
 *
 * @example
 * ```ts
 * import { encodeBase64 } from "https://deno.land/std@$STD_VERSION/encoding/base64.ts";
 *
 * encodeBase64("foobar"); // "Zm9vYmFy"
 * ```
 */
export function encodeBase64(data: ArrayBuffer | Uint8Array | string): string {
  // CREDIT: https://gist.github.com/enepomnyaschih/72c423f727d395eeaa09697058238727
  const uint8 = validateBinaryLike(data);
  let result = "",
    i;
  const l = uint8.length;
  for (i = 2; i < l; i += 3) {
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[((uint8[i - 2] & 0x03) << 4) | (uint8[i - 1] >> 4)];
    result += base64abc[((uint8[i - 1] & 0x0f) << 2) | (uint8[i] >> 6)];
    result += base64abc[uint8[i] & 0x3f];
  }
  if (i === l + 1) {
    // 1 octet yet to write
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[(uint8[i - 2] & 0x03) << 4];
    result += "==";
  }
  if (i === l) {
    // 2 octets yet to write
    result += base64abc[uint8[i - 2] >> 2];
    result += base64abc[((uint8[i - 2] & 0x03) << 4) | (uint8[i - 1] >> 4)];
    result += base64abc[(uint8[i - 1] & 0x0f) << 2];
    result += "=";
  }
  return result;
}

/**
 * Decodes a base64-encoded string.
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc4648#section-4}
 *
 * @example
 * ```ts
 * import { encodeBase64 } from "https://deno.land/std@$STD_VERSION/encoding/base64.ts";
 *
 * encodeBase64("foobar"); // "Zm9vYmFy"
 * ```
 */
export function decodeBase64(b64: string): Uint8Array {
  const binString = atob(b64);
  const size = binString.length;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}
