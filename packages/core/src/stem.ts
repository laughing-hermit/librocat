/**
 * Word stems for search: "deploying", "deployed", and "deploys" all become
 * "deploi", so a concept is found whichever form it or the question uses.
 * Convex's full-text search matches whole words (and the last word as a
 * prefix) with no stemming, so librocat indexes stemmed text and stems each
 * query the same way (apps/web/convex/model.ts search).
 *
 * The Porter stemmer (Martin Porter, 1980), after the classic JavaScript
 * port. Measured on 2026-09-28 with the search eval's questions: stemming,
 * with title and description matches weighted up, took the right concept
 * first from 61% to 75% of the time, by words alone (BLOCKER.md).
 */

const STEP2: Record<string, string> = {
  ational: "ate",
  tional: "tion",
  enci: "ence",
  anci: "ance",
  izer: "ize",
  bli: "ble",
  alli: "al",
  entli: "ent",
  eli: "e",
  ousli: "ous",
  ization: "ize",
  ation: "ate",
  ator: "ate",
  alism: "al",
  iveness: "ive",
  fulness: "ful",
  ousness: "ous",
  aliti: "al",
  iviti: "ive",
  biliti: "ble",
  logi: "log",
};
const STEP3: Record<string, string> = {
  icate: "ic",
  ative: "",
  alize: "al",
  iciti: "ic",
  ical: "ic",
  ful: "",
  ness: "",
};

const c = "[^aeiou]"; // consonant
const v = "[aeiouy]"; // vowel
const C = `${c}[^aeiouy]*`; // consonant sequence
const V = `${v}[aeiou]*`; // vowel sequence
const MGR0 = new RegExp(`^(${C})?${V}${C}`); // [C]VC... is m>0
const MEQ1 = new RegExp(`^(${C})?${V}${C}(${V})?$`); // [C]VC[V] is m=1
const MGR1 = new RegExp(`^(${C})?${V}${C}${V}${C}`); // [C]VCVC... is m>1
const S_V = new RegExp(`^(${C})?${v}`); // a vowel in the stem
const CVC = new RegExp(`^${C}${v}[^aeiouwxy]$`); // ends consonant-vowel-consonant

/** One lowercase word's Porter stem. */
export function stem(word: string): string {
  let w = word;
  if (w.length < 3) return w;
  const initialY = w[0] === "y";
  if (initialY) w = `Y${w.slice(1)}`;

  // Step 1a: plurals.
  const plural = /^(.+?)(ss|i)es$/.exec(w) ?? /^(.+?)([^s])s$/.exec(w);
  if (plural) w = `${plural[1]}${plural[2]}`;

  // Step 1b: -eed, -ed, -ing.
  const eed = /^(.+?)eed$/.exec(w);
  const eding = eed ? null : /^(.+?)(ed|ing)$/.exec(w);
  if (eed) {
    if (MGR0.test(eed[1] as string)) w = w.slice(0, -1);
  } else if (eding && S_V.test(eding[1] as string)) {
    w = eding[1] as string;
    if (/(at|bl|iz)$/.test(w)) w += "e";
    else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    else if (CVC.test(w)) w += "e";
  }

  // Step 1c: y to i.
  const y = /^(.+?)y$/.exec(w);
  if (y && S_V.test(y[1] as string)) w = `${y[1]}i`;

  // Steps 2 and 3: double and single suffixes.
  const s2 =
    /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(
      w,
    );
  if (s2 && MGR0.test(s2[1] as string)) w = `${s2[1]}${STEP2[s2[2] as string]}`;
  const s3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w);
  if (s3 && MGR0.test(s3[1] as string)) w = `${s3[1]}${STEP3[s3[2] as string]}`;

  // Step 4: -ant, -ence, -ment, ...
  const s4 =
    /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w);
  const ion = s4 ? null : /^(.+?)(s|t)(ion)$/.exec(w);
  if (s4) {
    if (MGR1.test(s4[1] as string)) w = s4[1] as string;
  } else if (ion && MGR1.test(`${ion[1]}${ion[2]}`)) {
    w = `${ion[1]}${ion[2]}`;
  }

  // Step 5: a final -e, and -ll.
  const e = /^(.+?)e$/.exec(w);
  if (e) {
    const s = e[1] as string;
    if (MGR1.test(s) || (MEQ1.test(s) && !CVC.test(s))) w = s;
  }
  if (/ll$/.test(w) && MGR1.test(w)) w = w.slice(0, -1);

  if (initialY) w = `y${w.slice(1)}`;
  return w;
}

/** Text as its words' stems, lowercase and space-separated: what the search indexes hold. */
export function stemText(text: string): string {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem)
    .join(" ");
}

/**
 * A query as the search indexes read it: stemmed, and its last 16 words
 * (Convex's limit per query; the last word, prefix-matched, stays last).
 */
export function stemQuery(query: string): string {
  return stemText(query).split(" ").filter(Boolean).slice(-16).join(" ");
}
