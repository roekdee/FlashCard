/**
 * Pure helpers for the production study modes (cloze, reverse, dictation,
 * shadow). No DOM here, so node can check them: see practice.check.mjs.
 */

/** Lowercase words, apostrophes kept ("don't"), everything else dropped. */
export const tokens = (text) =>
    (text || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];

const letters = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');

/** The part of a head word the learner types: "bank (money)" -> "bank". */
export const headword = (word) => (word || '').replace(/\s*\([^)]*\)/g, '').trim();

/** Levenshtein distance, capped: anything over `cap` returns cap + 1. */
export function editDistance(a, b, cap = 2) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
    }
    return Math.min(prev[b.length], cap + 1);
}

/**
 * Judge a typed English answer against the expected form(s).
 * 'exact' → right; 'close' → one slip in a word of six letters or more; else 'wrong'.
 */
export function judgeWord(guess, expected) {
    const g = letters(guess);
    if (!g) return 'wrong';
    const targets = (Array.isArray(expected) ? expected : [expected]).map(letters).filter(Boolean);
    if (targets.includes(g)) return 'exact';
    if (targets.some((t) => t.length >= 6 && editDistance(g, t, 1) <= 1)) return 'close';
    return 'wrong';
}

/**
 * Find the head word inside its example sentence, allowing common inflections
 * (abandon → abandoned, study → studies, make → making). Returns
 * { before, answer, after } or null when the sentence does not contain it.
 */
export function makeCloze(sentence, word) {
    const head = headword(word).toLowerCase();
    if (!sentence || !head) return null;
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stem = head.length > 3 ? escaped.replace(/(e|y)$/, '') : escaped;
    const pattern = new RegExp(
        `\\b(${escaped}(?:s|es|d|ed|ing|er|est|ly)?|${stem}(?:ies|ied|ier|iest|ing|ed|es)|${escaped}${escaped.slice(-1)}(?:ed|ing|er))\\b`,
        'i');
    const m = sentence.match(pattern);
    if (!m) return null;
    return {
        before: sentence.slice(0, m.index),
        answer: m[0],
        after: sentence.slice(m.index + m[0].length)
    };
}

/**
 * Word-level comparison of what the learner wrote or said with the reference
 * sentence (longest common subsequence). Returns per-reference-word hits and
 * the share of reference words matched.
 */
export function compareSentence(reference, attempt) {
    const ref = tokens(reference);
    const got = tokens(attempt);
    const dp = Array.from({ length: ref.length + 1 }, () => new Array(got.length + 1).fill(0));
    for (let i = ref.length - 1; i >= 0; i--) {
        for (let j = got.length - 1; j >= 0; j--) {
            dp[i][j] = ref[i] === got[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const hits = new Array(ref.length).fill(false);
    for (let i = 0, j = 0; i < ref.length && j < got.length;) {
        if (ref[i] === got[j]) { hits[i] = true; i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    const matched = hits.filter(Boolean).length;
    return { words: ref.map((w, i) => ({ word: w, hit: hits[i] })), ratio: ref.length ? matched / ref.length : 0 };
}

/** Sentence accuracy to an SM-2 grade. */
export const gradeFromRatio = (ratio) => (ratio >= 0.95 ? 5 : ratio >= 0.8 ? 4 : ratio >= 0.6 ? 3 : 1);
