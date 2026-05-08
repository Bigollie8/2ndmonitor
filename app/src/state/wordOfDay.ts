/** Free Dictionary API (https://dictionaryapi.dev/) for definitions; word
 *  selected deterministically by date from a curated list so it stays stable
 *  per calendar day across reloads. No API key required. */

const WORDS: string[] = [
  'serendipity', 'ephemeral', 'ubiquitous', 'mellifluous', 'petrichor',
  'sonder', 'ineffable', 'pellucid', 'limerence', 'apricity',
  'eunoia', 'susurrus', 'halcyon', 'zephyr', 'ethereal',
  'numinous', 'penumbra', 'incandescent', 'liminal', 'vellichor',
  'syzygy', 'crepuscular', 'sempiternal', 'effervescent', 'iridescent',
  'phosphorescent', 'evanescent', 'redolent', 'sonorous', 'lambent',
  'gossamer', 'perspicacious', 'tenuous', 'mercurial', 'sanguine',
  'taciturn', 'ebullient', 'quixotic', 'ineluctable', 'recalcitrant',
  'capricious', 'fastidious', 'inexorable', 'sycophant', 'palimpsest',
  'acquiesce', 'cacophony', 'denouement', 'esoteric', 'forte',
  'gambit', 'hubris', 'ineffable', 'juxtapose', 'kismet',
  'languid', 'magnanimous', 'nadir', 'obfuscate', 'paradigm',
  'quandary', 'rapport', 'supercilious', 'truncate', 'umbrage',
  'vicarious', 'wistful', 'xenial', 'yore', 'zealot',
];

export interface WordEntry {
  word: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  definition: string;
  example: string | null;
}

/** Pick a stable word for `today` using a date-seeded hash. Same date → same
 *  word, regardless of process restart or reload. */
export function wordForToday(): string {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return WORDS[seed % WORDS.length]!;
}

interface RawDictionaryResponse {
  word?: string;
  phonetic?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
}

export async function fetchWordEntry(word: string): Promise<WordEntry | null> {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as RawDictionaryResponse;
    const meaning = first.meanings?.[0];
    const def = meaning?.definitions?.[0];
    if (!def?.definition) return null;
    return {
      word: first.word ?? word,
      phonetic: first.phonetic ?? null,
      partOfSpeech: meaning?.partOfSpeech ?? null,
      definition: def.definition,
      example: def.example ?? null,
    };
  } catch (err) {
    console.warn('word-of-day fetch failed', err);
    return null;
  }
}
