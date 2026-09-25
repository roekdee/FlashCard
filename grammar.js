/**
 * Grammar lessons: sentence patterns ranked A1 (easiest) to C2 (hardest).
 *
 * The lessons are static content (grammar.json, built from grammar/*.json), so
 * they load straight from the site and work offline once cached. Progress is
 * account data: every finished quiz goes through review_grammar, which puts the
 * lesson on the same SM-2 schedule as the words, so passed lessons come back
 * for review instead of being done once and forgotten.
 *
 * Free accounts see the same levels as the word deck allows; that gate is
 * cosmetic here because the content is public anyway.
 */

import * as api from './api.js?v=dev';
import { ICON } from './icons.js?v=dev';

const PASS_MARK = 4;                       // out of 5 quiz questions

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let lessons = null;
let deps = null;
let level = 'A1';
let quiz = null;                           // { lesson, index, score, answered }
let progress = new Map();                  // lesson_id -> grammar_progress row

const isPassed = (id) => Boolean(progress.get(id)?.passed_at);
const isDue = (id) => {
    const row = progress.get(id);
    return Boolean(row?.passed_at && row.due_at && new Date(row.due_at) <= new Date());
};

/**
 * @param {{ allowedLevels: () => string[] | null, speak: (text: string) => void, goPro: () => void }} d
 */
export function initGrammar(d) {
    deps = d;
    $('grammarLevelChips').addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        if (isLocked(chip.dataset.level)) return deps.goPro();
        level = chip.dataset.level;
        renderList();
    });
    $('grammarList').addEventListener('click', (e) => {
        const row = e.target.closest('[data-lesson]');
        if (row) openLesson(row.dataset.lesson);
    });
    $('grammarBack').addEventListener('click', () => { quiz = null; renderList(); });
    $('grammarDetail').addEventListener('click', (e) => {
        const say = e.target.closest('[data-say]');
        if (say) return deps.speak(say.dataset.say);
        const opt = e.target.closest('[data-option]');
        if (opt) answer(Number(opt.dataset.option), opt);
        if (e.target.closest('#grammarNext')) nextQuestion();
        if (e.target.closest('#grammarRetry')) openLesson(quiz.lesson.id);
    });
    $('grammarDue').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lesson]');
        if (btn) openLesson(btn.dataset.lesson);
    });
}

const isLocked = (lv) => {
    const allowed = deps.allowedLevels();
    return Boolean(allowed) && !allowed.includes(lv);
};

export async function showGrammar() {
    if (!lessons) {
        $('grammarList').innerHTML = '<p class="loading">กำลังโหลดบทเรียน...</p>';
        try {
            const res = await fetch('grammar.json?v=dev');
            if (!res.ok) throw new Error(res.status);
            lessons = await res.json();
        } catch {
            $('grammarList').innerHTML = '<p class="field-hint">โหลดบทเรียนไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
            return;
        }
    }
    try {
        progress = new Map((await api.getGrammarProgress()).map((row) => [row.lesson_id, row]));
    } catch { /* offline: show the list without progress */ }
    if (!quiz) renderList();
}

function renderDue() {
    const due = lessons.filter((l) => isDue(l.id) && !isLocked(l.level));
    $('grammarDue').innerHTML = due.length ? `
        <h4 class="panel-title">${ICON.calendar} ถึงรอบทบทวน ${due.length} บท</h4>
        <div class="chips">${due.map((l) =>
            `<button class="chip" data-lesson="${esc(l.id)}">${esc(l.level)} · ${esc(l.title)}</button>`).join('')}
        </div>` : '';
}

function renderList() {
    renderDue();
    $('grammarLevelChips').querySelectorAll('.chip').forEach((chip) => {
        const lv = chip.dataset.level;
        const all = lessons.filter((l) => l.level === lv);
        const passed = all.filter((l) => isPassed(l.id)).length;
        chip.classList.toggle('is-active', lv === level);
        chip.classList.toggle('is-locked', isLocked(lv));
        chip.innerHTML = `${esc(lv)}${isLocked(lv) ? ` ${ICON.lock}` : ''} · ${passed}/${all.length}`;
    });

    $('grammarDetail').hidden = true;
    $('grammarBack').hidden = true;
    $('grammarDue').hidden = !$('grammarDue').innerHTML;
    $('grammarList').hidden = false;
    $('grammarList').innerHTML = lessons
        .filter((l) => l.level === level)
        .map((l, i) => `
            <button class="grammar-row${isPassed(l.id) ? ' is-done' : ''}" data-lesson="${esc(l.id)}">
                <span class="grammar-row-num">${i + 1}</span>
                <span class="grammar-row-main">
                    <strong>${esc(l.title)}</strong>
                    <span>${esc(l.title_th)}</span>
                    <code>${esc(l.pattern)}</code>
                </span>
                <span class="grammar-row-state">${isDue(l.id) ? ICON.repeat : isPassed(l.id) ? ICON.checkCircle : '›'}</span>
            </button>`)
        .join('');
}

function openLesson(id) {
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;
    quiz = { lesson, index: 0, score: 0, answered: false };

    $('grammarList').hidden = true;
    $('grammarDue').hidden = true;
    $('grammarBack').hidden = false;
    const box = $('grammarDetail');
    box.hidden = false;
    box.innerHTML = `
        <div class="panel">
            <p class="grammar-level"><span class="level-tag">${esc(lesson.level)}</span></p>
            <h3 class="grammar-title">${esc(lesson.title)}</h3>
            <p class="grammar-title-th">${esc(lesson.title_th)}</p>
            <p class="grammar-pattern"><code>${esc(lesson.pattern)}</code></p>
            <p class="grammar-explain">${esc(lesson.explain)}</p>
            <ul class="grammar-examples">
                ${lesson.examples.map((ex) => `
                    <li>
                        <button class="speak-btn" data-say="${esc(ex.en)}" aria-label="ฟังประโยค">${ICON.speaker}</button>
                        <span><span class="example-en">${esc(ex.en)}</span>
                        <span class="example-th">${esc(ex.th)}</span></span>
                    </li>`).join('')}
            </ul>
        </div>
        <div class="panel" id="grammarQuiz"></div>`;
    renderQuestion();
}

/** The authored answers cluster on the first two options; shuffle so position gives nothing away. */
function shuffled(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function renderQuestion() {
    const { lesson, index } = quiz;
    const q = lesson.quiz[index];
    quiz.answered = false;
    const [before, after] = q.q.split('___');
    $('grammarQuiz').innerHTML = `
        <h4 class="panel-title">แบบฝึกหัด ${index + 1} / ${lesson.quiz.length}</h4>
        <p class="grammar-question">${esc(before)}<span class="grammar-blank">____</span>${esc(after ?? '')}</p>
        <div class="quiz-options">
            ${shuffled(q.options.map((o, i) => [o, i]))
                .map(([o, i]) => `<button class="quiz-option" data-option="${i}">${esc(o)}</button>`).join('')}
        </div>
        <p class="grammar-feedback" id="grammarFeedback"></p>`;
}

function answer(choice, btn) {
    if (!quiz || quiz.answered) return;
    quiz.answered = true;
    const q = quiz.lesson.quiz[quiz.index];
    const right = choice === q.answer;
    if (right) quiz.score++;

    $('grammarQuiz').querySelector(`[data-option="${q.answer}"]`).classList.add('is-correct');
    if (!right) btn.classList.add('is-wrong');
    $('grammarQuiz').querySelector('.quiz-options').classList.add('is-answered');

    const last = quiz.index === quiz.lesson.quiz.length - 1;
    $('grammarFeedback').innerHTML = `
        ${right ? `${ICON.checkCircle} ถูกต้อง` : `${ICON.xCircle} ยังไม่ถูก`} · ${esc(q.q.replace('___', q.options[q.answer]))}
        <span class="example-th">${esc(q.th)}</span>
        <button class="btn btn-primary" id="grammarNext">${last ? 'ดูผล' : 'ข้อต่อไป →'}</button>`;
}

async function nextQuestion() {
    if (quiz.index < quiz.lesson.quiz.length - 1) {
        quiz.index++;
        return renderQuestion();
    }
    const { lesson, score } = quiz;
    const total = lesson.quiz.length;
    const passed = score >= PASS_MARK;
    let next = '';
    try {
        const row = await api.reviewGrammar(lesson.id, score, total);
        progress.set(lesson.id, row);
        next = passed ? `จะชวนกลับมาทบทวนอีกใน ${row.interval_days} วัน` : 'บทนี้จะกลับมาให้ทบทวนพรุ่งนี้';
    } catch (err) {
        next = 'บันทึกผลไม่สำเร็จ: ' + err.message;
    }
    $('grammarQuiz').innerHTML = `
        <h4 class="panel-title">ผลแบบฝึกหัด</h4>
        <p class="grammar-score">${score} / ${total}</p>
        <p>${passed ? 'ผ่านบทนี้แล้ว' : `ต้องได้อย่างน้อย ${PASS_MARK} ข้อถึงจะผ่าน ลองทบทวนตัวอย่างแล้วทำใหม่`}</p>
        <p class="field-hint">${esc(next)}</p>
        <div class="secondary-row">
            <button class="btn btn-secondary" id="grammarRetry">ทำใหม่</button>
        </div>`;
}
