/**
 * Reading tab: graded short stories (A1-C2) with tappable-word lookup and
 * end-of-story comprehension quizzes.
 *
 * Story content is static (reading.json, built from reading/*.json), so it
 * loads straight from the site and works offline once cached. Word lookups
 * hit the live word bank through api.searchWords/api.queueWord.
 *
 * Which stories a viewer has finished is a convenience kept in localStorage,
 * not account data.
 */

import * as api from './api.js?v=dev';
import { ICON } from './icons.js?v=dev';

const DONE_KEY = 'flash_reading_done';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WORD_RE = /([A-Za-z]+(?:['’][A-Za-z]+)?)/g;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let stories = null;
let deps = null;
let level = 'A1';
let story = null;
let quiz = null;                           // { index, score, answered }
let lookupCache = new Map();               // lowercased term -> row | null

function loadDone() {
    try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); }
    catch { return {}; }
}

function saveDone(done) {
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* not kept */ }
}

const isLocked = (lv) => {
    const allowed = deps.allowedLevels();
    return Boolean(allowed) && !allowed.includes(lv);
};

const wordCount = (s) => s.paragraphs.reduce((n, p) => n + p.en.trim().split(/\s+/).filter(Boolean).length, 0);

/**
 * @param {{
 *   speak: (text: string, rate?: number) => void,
 *   toast: (message: string) => void,
 *   isPro: () => boolean,
 *   allowedLevels: () => string[] | null,
 *   goPro: () => void
 * }} d
 */
export function initReading(d) {
    deps = d;
    const root = $('readingRoot');
    root.innerHTML = `
        <div class="chips reading-chips" id="readingChips"></div>
        <div class="reading-list" id="readingList"></div>
        <div class="reading-story" id="readingStory" hidden></div>
        <div class="reading-lookup-backdrop" id="readingLookupBackdrop" hidden></div>
        <div class="reading-lookup" id="readingLookup" hidden></div>`;

    root.addEventListener('click', onRootClick);
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLookup(); });
}

export async function showReading() {
    if (!stories) {
        $('readingList').innerHTML = '<p class="loading">กำลังโหลดเรื่อง...</p>';
        try {
            const res = await fetch('reading.json?v=dev');
            if (!res.ok) throw new Error(res.status);
            stories = await res.json();
        } catch {
            $('readingList').innerHTML = '<p class="field-hint">โหลดเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
            return;
        }
    }
    if (!story) renderList();
}

function onRootClick(e) {
    const chip = e.target.closest('.reading-chips .chip');
    if (chip) {
        if (isLocked(chip.dataset.level)) return deps.goPro();
        level = chip.dataset.level;
        return renderList();
    }
    const row = e.target.closest('[data-story]');
    if (row) return openStory(row.dataset.story);

    if (e.target.closest('#readingBack')) { story = null; quiz = null; return renderList(); }

    const say = e.target.closest('[data-say]');
    if (say) return deps.speak(say.dataset.say, say.dataset.rate ? Number(say.dataset.rate) : undefined);

    const translate = e.target.closest('[data-translate]');
    if (translate) {
        const th = translate.closest('.reading-paragraph').querySelector('.reading-para-th');
        th.hidden = !th.hidden;
        return;
    }

    const word = e.target.closest('.reading-word');
    if (word) return onWordTap(word);

    const opt = e.target.closest('#readingQuiz [data-option]');
    if (opt) return answerQuestion(Number(opt.dataset.option), opt);
    if (e.target.closest('#readingNext')) return nextQuestion();
    if (e.target.closest('#readingRetry')) return retryQuiz();

    if (e.target.closest('#readingLookupClose')) return closeLookup();
    const add = e.target.closest('#readingLookupAdd');
    if (add) return addToReview(add.dataset.id, add.dataset.word);
}

function onOutsideClick(e) {
    const lookup = $('readingLookup');
    if (lookup.hidden) return;
    if (lookup.contains(e.target) || e.target.closest('.reading-word')) return;
    closeLookup();
}

/* ===================== LIST ===================== */

function renderList() {
    const done = loadDone();
    $('readingChips').innerHTML = LEVELS.map((lv) => {
        const all = stories.filter((s) => s.level === lv);
        const read = all.filter((s) => s.id in done).length;
        const locked = isLocked(lv);
        return `<button class="chip${lv === level ? ' is-active' : ''}${locked ? ' is-locked' : ''}" data-level="${lv}">${lv}${locked ? ` ${ICON.lock}` : ''} · ${read}/${all.length}</button>`;
    }).join('');

    $('readingStory').hidden = true;
    $('readingList').hidden = false;
    const items = stories.filter((s) => s.level === level);
    $('readingList').innerHTML = items.length ? items.map((s) => `
        <button class="reading-row" data-story="${esc(s.id)}">
            <span class="reading-row-main">
                <strong>${esc(s.title)}</strong>
                <span>${esc(s.title_th)}</span>
                <span class="reading-row-meta">${esc(s.topic)} · ${wordCount(s)} คำ</span>
            </span>
            <span class="reading-row-state">${s.id in done ? ICON.checkCircle : '›'}</span>
        </button>`).join('') : '<p class="field-hint">ยังไม่มีเรื่องในระดับนี้</p>';
}

/* ===================== STORY ===================== */

function openStory(id) {
    const s = stories.find((x) => x.id === id);
    if (!s) return;
    story = s;
    quiz = { index: 0, score: 0, answered: false };
    closeLookup();

    $('readingList').hidden = true;
    const box = $('readingStory');
    box.hidden = false;
    box.innerHTML = `
        <button class="btn btn-secondary reading-back" id="readingBack">← กลับ</button>
        <div class="panel">
            <p><span class="level-tag">${esc(story.level)}</span></p>
            <h3 class="reading-title">${esc(story.title)}</h3>
            <p class="reading-title-th">${esc(story.title_th)}</p>
            <div class="reading-paragraphs">
                ${story.paragraphs.map(renderParagraph).join('')}
            </div>
        </div>
        <div class="panel" id="readingQuiz"></div>`;
    renderQuestion();
}

function renderParagraph(p) {
    return `
        <div class="reading-paragraph">
            <div class="reading-para-controls">
                <button class="speak-btn" data-say="${esc(p.en)}" data-rate="0.9" aria-label="ฟังย่อหน้า">${ICON.speaker}</button>
                <button class="btn btn-secondary reading-translate" data-translate="1">แปล</button>
            </div>
            <p class="reading-para-en">${tokenize(p.en)}</p>
            <p class="reading-para-th" hidden>${esc(p.th)}</p>
        </div>`;
}

function tokenize(text) {
    return String(text).split(WORD_RE).map((part, i) => (i % 2 === 1
        ? `<span class="reading-word" data-word="${esc(part)}">${esc(part)}</span>`
        : esc(part))).join('');
}

/* ===================== WORD LOOKUP ===================== */

function lemmas(w) {
    const out = [];
    const add = (x) => { if (x && x !== w && !out.includes(x)) out.push(x); };
    if (w.endsWith('s')) add(w.slice(0, -1));
    if (w.endsWith('es')) add(w.slice(0, -2));
    if (w.endsWith('ed')) add(w.slice(0, -2));
    if (w.endsWith('d')) add(w.slice(0, -1));
    if (w.endsWith('ing')) add(w.slice(0, -3));
    if (w.endsWith('ly')) add(w.slice(0, -2));
    if (w.endsWith('ier')) add(`${w.slice(0, -3)}y`);
    if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`);
    return out;
}

async function exactMatch(term) {
    let rows;
    try { rows = await api.searchWords(term, null, 20); }
    catch { return null; }
    return rows.find((r) => r.word.toLowerCase() === term) || null;
}

async function findWord(term) {
    const direct = await exactMatch(term);
    if (direct) return direct;
    for (const lemma of lemmas(term)) {
        const found = await exactMatch(lemma);
        if (found) return found;
    }
    return null;
}

async function lookup(term) {
    if (lookupCache.has(term)) return lookupCache.get(term);
    const result = await findWord(term);
    lookupCache.set(term, result);
    return result;
}

async function onWordTap(el) {
    const raw = el.textContent;
    const term = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!term) return;
    openLookupLoading(raw);
    const result = await lookup(term);
    renderLookup(raw, result);
}

function openLookupLoading(raw) {
    $('readingLookupBackdrop').hidden = false;
    const el = $('readingLookup');
    el.hidden = false;
    el.innerHTML = `
        <div class="reading-lookup-card">
            <button class="reading-lookup-close" id="readingLookupClose" aria-label="ปิด">${ICON.close}</button>
            <p class="reading-lookup-word">${esc(raw)}</p>
            <p class="loading">กำลังค้นหา...</p>
        </div>`;
}

function renderLookup(raw, result) {
    const el = $('readingLookup');
    if (el.hidden) return;                 // closed while the lookup was in flight
    el.innerHTML = !result ? `
        <div class="reading-lookup-card">
            <button class="reading-lookup-close" id="readingLookupClose" aria-label="ปิด">${ICON.close}</button>
            <p class="reading-lookup-word">${esc(raw)}</p>
            <p class="field-hint">ไม่พบคำนี้ในคลัง</p>
        </div>` : `
        <div class="reading-lookup-card">
            <button class="reading-lookup-close" id="readingLookupClose" aria-label="ปิด">${ICON.close}</button>
            <p class="reading-lookup-word">
                ${esc(result.word)}
                <button class="speak-btn" data-say="${esc(result.word)}" aria-label="ฟังคำ">${ICON.speaker}</button>
            </p>
            <p class="reading-lookup-meta">
                ${result.pos ? `<span class="pos-tag">${esc(result.pos)}</span>` : ''}
                <span class="level-tag">${esc(result.level)}</span>
            </p>
            ${result.pronunciation ? `<p class="reading-lookup-pron">${esc(result.pronunciation)}</p>` : ''}
            <p class="reading-lookup-translation">${esc(result.translation)}</p>
            <button class="btn btn-primary reading-lookup-add" id="readingLookupAdd" data-id="${esc(result.id)}" data-word="${esc(result.word)}">${ICON.plus} เพิ่มเข้าทบทวนวันนี้</button>
        </div>`;
}

function closeLookup() {
    const el = $('readingLookup');
    if (el.hidden) return;
    el.hidden = true;
    $('readingLookupBackdrop').hidden = true;
    el.innerHTML = '';
}

async function addToReview(id, word) {
    try {
        await api.queueWord(id);           // words.id is a uuid
        deps.toast(`เพิ่ม "${word}" เข้าทบทวนแล้ว`);
        closeLookup();
    } catch (err) {
        deps.toast(err?.message || 'เพิ่มไม่สำเร็จ');
    }
}

/* ===================== QUIZ ===================== */

/** The authored answers cluster on the first options; shuffle so position gives nothing away. */
function shuffled(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function renderQuestion() {
    const q = story.questions[quiz.index];
    quiz.answered = false;
    $('readingQuiz').innerHTML = `
        <h4 class="panel-title">คำถามที่ ${quiz.index + 1} / ${story.questions.length}</h4>
        <p class="reading-question">${esc(q.q)}</p>
        <div class="quiz-options">
            ${shuffled(q.options.map((o, i) => [o, i]))
                .map(([o, i]) => `<button class="quiz-option" data-option="${i}">${esc(o)}</button>`).join('')}
        </div>
        <p class="reading-feedback" id="readingFeedback"></p>`;
}

function answerQuestion(choice, btn) {
    if (!quiz || quiz.answered) return;
    quiz.answered = true;
    const q = story.questions[quiz.index];
    const right = choice === q.answer;
    if (right) quiz.score++;

    $('readingQuiz').querySelector(`[data-option="${q.answer}"]`).classList.add('is-correct');
    if (!right) btn.classList.add('is-wrong');
    $('readingQuiz').querySelector('.quiz-options').classList.add('is-answered');

    const last = quiz.index === story.questions.length - 1;
    $('readingFeedback').innerHTML = `
        ${right ? `${ICON.checkCircle} ถูกต้อง` : `${ICON.xCircle} ยังไม่ถูก`}
        <span class="example-th">${esc(q.explain_th)}</span>
        <button class="btn btn-primary" id="readingNext">${last ? 'ดูผล' : 'ข้อต่อไป →'}</button>`;
}

function nextQuestion() {
    if (quiz.index < story.questions.length - 1) {
        quiz.index++;
        return renderQuestion();
    }
    const done = loadDone();
    done[story.id] = Math.max(done[story.id] || 0, quiz.score);
    saveDone(done);

    $('readingQuiz').innerHTML = `
        <h4 class="panel-title">ผลคำถามท้ายเรื่อง</h4>
        <p class="reading-score">${quiz.score} / ${story.questions.length}</p>
        <div class="secondary-row">
            <button class="btn btn-secondary" id="readingRetry">ทำใหม่</button>
        </div>`;
}

function retryQuiz() {
    quiz = { index: 0, score: 0, answered: false };
    renderQuestion();
}
