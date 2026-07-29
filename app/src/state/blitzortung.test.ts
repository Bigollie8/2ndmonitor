import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeLZW } from './blitzortung';

/** Helper: build a "compressed" input string from a list of char codes.
 *  Codes < 256 are literal characters; codes >= 256 are dictionary references.
 *  The decoder assigns dictionary slots 256, 257, ... one per input position
 *  after the first (dict[256 + (i-1)] = previousEntry + firstCharOfCurrentEntry). */
function codes(...cs: (number | string)[]): string {
  return cs.map((c) => (typeof c === 'string' ? c : String.fromCharCode(c))).join('');
}

test('decodeLZW: string of plain ASCII with no dictionary codes decodes to itself', () => {
  // Every char code is < 256, so each input char is taken literally and the
  // output equals the input (the dictionary is built but never referenced).
  assert.equal(decodeLZW('hello world'), 'hello world');
  assert.equal(decodeLZW('{"time":1}'), '{"time":1}');
});

test('decodeLZW: degenerate inputs do not throw', () => {
  assert.equal(decodeLZW(''), '');
  // Single char: the loop body never runs, output is the char itself.
  assert.equal(decodeLZW('x'), 'x');
});

test('decodeLZW: simple dictionary reference — "ab"+code256+"c" -> "ababc"', () => {
  // Hand-execution:
  //   out=['a']; last='a'
  //   i=1 'b' (literal): out=['a','b'], dict[256]='ab', last='b'
  //   i=2 code 256: dict[256]='ab' -> out=['a','b','ab'], dict[257]='ba', last='ab'
  //   i=3 'c' (literal): out=['a','b','ab','c'], dict[258]='abc'
  // => 'ababc'. This is also exactly what a standard LZW compressor emits
  // for 'ababc' (a, b, <256>, c), so it round-trips the real algorithm.
  assert.equal(decodeLZW(codes('a', 'b', 256, 'c')), 'ababc');
});

test('decodeLZW: KwKwK special case — code not yet in dictionary', () => {
  // Compressing 'aaa' with LZW emits ('a', <256>) where code 256 is defined
  // *by* the very entry being decoded. Decoder hits the else-branch:
  //   entry = last + curr = 'a' + 'a' = 'aa'; out = ['a','aa'] => 'aaa'.
  assert.equal(decodeLZW(codes('a', 256)), 'aaa');

  // One step further: ('a', <256>, <257>) is LZW for 'aaaaaa'.
  //   i=1 code 256 (undefined): entry='aa', dict[256]='aa', last='aa'
  //   i=2 code 257 (undefined): entry=last+curr='aa'+'a'='aaa', dict[257]='aaa'
  // out = 'a'+'aa'+'aaa' = 6 a's.
  assert.equal(decodeLZW(codes('a', 256, 257)), 'aaaaaa');
});

test('decodeLZW: dictionary growth across literals — "banana"', () => {
  // Standard LZW compression of 'banana' emits (b, a, n, <257>, a):
  //   dict built by decoder: 256='ba', 257='an', 258='na', 259='ana'
  // Hand-execution of the decoder:
  //   out=['b']; i=1 'a': dict[256]='ba'; i=2 'n': dict[257]='an';
  //   i=3 code 257 -> 'an': out+='an', dict[258]='na';
  //   i=4 'a': out+='a', dict[259]='ana'
  // => 'b'+'a'+'n'+'an'+'a' = 'banana'.
  assert.equal(decodeLZW(codes('b', 'a', 'n', 257, 'a')), 'banana');
});

test('decodeLZW: realistic JSON payload with repeated substrings', () => {
  // Target: {"lat":45.5,"lon":45.5} — repeats '"l', '":', '45', '.5'.
  // Hand-run of a standard LZW compressor over the target yields the codes
  // below; decoder dictionary slots (one per position after the first):
  //   256='{"' 257='"l' 258='la' 259='at' 260='t"' 261='":' 262=':4'
  //   263='45' 264='5.' 265='.5' 266='5,' 267=',"' 268='"lo' 269='on' ...
  // References used: 257 -> '"l', 261 -> '":', 263 -> '45', 265 -> '.5'.
  const compressed = codes(
    '{', '"', 'l', 'a', 't', '"', ':', '4', '5', '.', '5', ',',
    257, 'o', 'n', 261, 263, 265, '}',
  );
  const decoded = decodeLZW(compressed);
  assert.equal(decoded, '{"lat":45.5,"lon":45.5}');
  // And it is valid JSON, as the websocket handler requires.
  assert.deepEqual(JSON.parse(decoded), { lat: 45.5, lon: 45.5 });
});
