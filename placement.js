/**
 * English level check (CEFR A1–C2): a ~5 minute placement quiz with history.
 *
 * Items come from `get_placement_items` (ordered A1→C2). The test walks level
 * by level; once a level's accuracy drops below 40% the run stops early and
 * every level from there on counts as 0, exactly like a level never reached
 * counts as 0 in scoring. Estimated level and vocabulary size are computed
 * client-side from the per-level accuracies and `stats.level_totals`.
 */
import * as api from './api.js?v=dev';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const LEVEL_DESC = {
    A1: 'เข้าใจคำศัพท์และประโยคง่าย ๆ ในชีวิตประจำวัน',
    A2: 'สื่อสารเรื่องพื้นฐานได้ เช่น ซื้อของ ถามทาง แนะนำตัว',
    B1: 'คุยเรื่องทั่วไป เดินทาง หรือทำงานง่าย ๆ ได้คล่องขึ้น',
    B2: 'เข้าใจบทความและคุยเรื่องซับซ้อนได้อย่างมั่นใจ',
    C1: 'ใช้ภาษาได้คล่องในที่ทำงานหรือการเรียนระดับสูง',
    C2: 'ใช้ภาษาได้ใกล้เคียงเจ้าของภาษา แม่นยำและเป็นธรรมชาติ'
};

const PASS_LEVEL = 0.6;   // accuracy needed to claim a level
const PASS_BELOW = 0.5;   // accuracy needed on every level below it
const STOP_BELOW = 0.4;   // a level under this stops the run early

const $ = () => document.getElementById('levelRoot');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let deps = null;
let history = null;      // cached get_level_checks rows, newest first
let levelTotals = null;  // cached stats.level_totals
let run = null;          // active test state, or null on intro/result screens

/**
 * @param {{ speak: (text: string) => void, toast: (message: string) => void, applyLevel: (level: string) => void }} d
 */
export function initLevel(d) {
    deps = d;
    $().addEventListener('click', onClick);
}

export async function showLevel() {
    run = null;
    $().innerHTML = '<p class="loading">กำลังโหลด...</p>';
    try {
        const [checks, stats] = await Promise.all([api.getLevelChecks(), api.getStats()]);
        history = checks;
        levelTotals = stats.level_totals || {};
    } catch (err) {
        deps.toast(err.message || 'โหลดข้อมูลไม่สำเร็จ');
        history = history || [];
        levelTotals = levelTotals || {};
    }
    renderIntro();
}

function onClick(e) {
    if (e.target.closest('[data-action="start"]')) return startRun();
    if (e.target.closest('[data-action="retry"]')) return renderIntro();
    const applyBtn = e.target.closest('[data-action="apply"]');
    if (applyBtn) return deps.applyLevel(applyBtn.dataset.level);
    const say = e.target.closest('[data-say]');
    if (say) return deps.speak(say.dataset.say);
    if (e.target.closest('[data-action="next"]')) return nextItem();
    const opt = e.target.closest('.quiz-option[data-idx]');
    if (opt && run && !run.answered) return answer(opt);
}

/** The authored answers cluster on the first option; shuffle so position gives nothing away. */
function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ===================== SCORING (pure, unit-checked) =====================

/**
 * Highest level L where accuracy(L) >= 60% and every level below L is >= 50%.
 * @param {Record<string, number>} acc accuracy 0-1 per level, missing = 0
 * @returns {string}
 */
export function estimateLevel(acc) {
    let result = 'A1';
    for (let i = 0; i < LEVELS.length; i++) {
        const lv = LEVELS[i];
        const belowOk = LEVELS.slice(0, i).every((below) => (acc[below] ?? 0) >= PASS_BELOW);
        const meets = (acc[lv] ?? 0) >= PASS_LEVEL;
        if (belowOk && meets) result = lv;
    }
    return result;
}

/** Sum of accuracy × level_totals per level, rounded to the nearest 50 words. */
export function estimateVocab(acc, totals) {
    const raw = LEVELS.reduce((sum, lv) => sum + (acc[lv] ?? 0) * (totals[lv] ?? 0), 0);
    return Math.round(raw / 50) * 50;
}

/** Overall 0-100 score: average accuracy across all six levels. */
export function overallScore(acc) {
    const sum = LEVELS.reduce((s, lv) => s + (acc[lv] ?? 0), 0);
    return Math.round((sum / LEVELS.length) * 100);
}

// ===================== TEST RUN =====================

async function startRun() {
    $().innerHTML = '<p class="loading">กำลังโหลดคำศัพท์...</p>';
    let items;
    try {
        items = await api.getPlacementItems(8);
    } catch (err) {
        deps.toast(err.message || 'โหลดแบบทดสอบไม่สำเร็จ');
        return renderIntro();
    }
    const itemsByLevel = {};
    for (const lv of LEVELS) itemsByLevel[lv] = items.filter((it) => it.level === lv);
    const levels = LEVELS.filter((lv) => itemsByLevel[lv].length);
    if (!levels.length) {
        deps.toast('ไม่พบคำศัพท์สำหรับแบบทดสอบ');
        return renderIntro();
    }
    run = {
        itemsByLevel, levels, levelIndex: 0,
        items: itemsByLevel[levels[0]], itemIndex: 0,
        correctInLevel: 0, doneItems: 0, totalItems: items.length,
        accuracies: Object.fromEntries(LEVELS.map((lv) => [lv, 0])),
        answered: false, correctIdx: -1
    };
    renderQuestion();
}

function renderQuestion() {
    run.answered = false;
    const level = run.levels[run.levelIndex];
    const item = run.items[run.itemIndex];
    const choices = shuffle([
        { text: item.translation, correct: true },
        ...item.options.map((o) => ({ text: o, correct: false }))
    ]);
    run.correctIdx = choices.findIndex((c) => c.correct);
    const pct = Math.round((run.doneItems / run.totalItems) * 100);
    $().innerHTML = `
        <div class="panel placement-quiz">
            <div class="placement-progress"><span style="width:${pct}%"></span></div>
            <p class="placement-meta"><span class="level-tag">${esc(level)}</span> ข้อ ${run.itemIndex + 1}/${run.items.length}</p>
            <p class="placement-word">${esc(item.word)}
                <button class="speak-btn" data-say="${esc(item.word)}" aria-label="ฟังคำนี้">🔊</button></p>
            <div class="quiz-options">
                ${choices.map((c, i) => `<button class="quiz-option" data-idx="${i}">${esc(c.text)}</button>`).join('')}
                <button class="quiz-option placement-unknown" data-idx="unknown">ไม่รู้จักคำนี้</button>
            </div>
            <p class="placement-feedback" id="levelFeedback"></p>
        </div>`;
}

function answer(btn) {
    run.answered = true;
    const idx = btn.dataset.idx;
    const correct = idx === String(run.correctIdx);
    if (correct) run.correctInLevel++;

    const optionsEl = $().querySelector('.quiz-options');
    optionsEl.classList.add('is-answered');
    optionsEl.querySelector(`[data-idx="${run.correctIdx}"]`).classList.add('is-correct');
    if (!correct && idx !== 'unknown') btn.classList.add('is-wrong');

    const isLastOverall = run.levelIndex === run.levels.length - 1 && run.itemIndex === run.items.length - 1;
    document.getElementById('levelFeedback').innerHTML =
        `<button class="btn btn-primary" data-action="next">${isLastOverall ? 'ดูผล' : 'ข้อต่อไป →'}</button>`;
}

function nextItem() {
    const level = run.levels[run.levelIndex];
    run.itemIndex++;
    run.doneItems++;
    if (run.itemIndex < run.items.length) return renderQuestion();

    const acc = run.correctInLevel / run.items.length;
    run.accuracies[level] = acc;
    const isLastLevel = run.levelIndex === run.levels.length - 1;
    if (acc < STOP_BELOW || isLastLevel) return finishRun();

    run.levelIndex++;
    run.items = run.itemsByLevel[run.levels[run.levelIndex]];
    run.itemIndex = 0;
    run.correctInLevel = 0;
    renderQuestion();
}

async function finishRun() {
    const accuracies = run.accuracies;
    const level = estimateLevel(accuracies);
    const vocabSize = estimateVocab(accuracies, levelTotals);
    const score = overallScore(accuracies);
    const previous = history && history[0];
    run = null;

    try {
        await api.saveLevelCheck(level, score, vocabSize);
    } catch (err) {
        deps.toast(err.message || 'บันทึกผลไม่สำเร็จ');
    }
    renderResult({ level, vocabSize, score, accuracies }, previous);

    try { history = await api.getLevelChecks(); } catch { /* keep the stale copy */ }
}

// ===================== RENDER: RESULT =====================

function compareLevel(level, prevLevel) {
    const cur = LEVELS.indexOf(level);
    const prev = LEVELS.indexOf(prevLevel);
    if (cur > prev) return `ขึ้นจากครั้งก่อน (${esc(prevLevel)} → ${esc(level)}) 📈`;
    if (cur < prev) return `ลดลงจากครั้งก่อน (${esc(prevLevel)} → ${esc(level)}) 📉`;
    return `เท่ากับครั้งก่อน (${esc(level)})`;
}

function renderResult({ level, vocabSize, score, accuracies }, previous) {
    const compare = previous ? compareLevel(level, previous.level) : '';
    $().innerHTML = `
        <div class="panel placement-result">
            <p class="placement-badge-level">${esc(level)}</p>
            <p class="placement-badge-desc">${esc(LEVEL_DESC[level] || '')}</p>
            ${compare ? `<p class="field-hint">${compare}</p>` : ''}
            <p class="placement-vocab">คำศัพท์โดยประมาณ ~${vocabSize.toLocaleString('th-TH')} คำ · คะแนนรวม ${score}/100</p>
            <div class="level-bars">
                ${LEVELS.map((lv) => `
                    <div class="level-bar">
                        <span class="level-bar-name">${lv}</span>
                        <span class="level-bar-track"><span class="level-bar-fill" style="width:${Math.round((accuracies[lv] || 0) * 100)}%"></span></span>
                        <span class="level-bar-value">${Math.round((accuracies[lv] || 0) * 100)}%</span>
                    </div>`).join('')}
            </div>
            <div class="secondary-row">
                <button class="btn btn-primary" data-action="apply" data-level="${esc(level)}">เริ่มเรียนคำระดับนี้</button>
                <button class="btn btn-secondary" data-action="retry">วัดใหม่</button>
            </div>
        </div>
        <div class="panel">
            <h4 class="panel-title">คำอธิบายแต่ละระดับ</h4>
            ${LEVELS.map((lv) => `<p class="placement-desc-row"><span class="level-tag">${esc(lv)}</span> ${esc(LEVEL_DESC[lv])}</p>`).join('')}
        </div>`;
}

// ===================== RENDER: INTRO + HISTORY =====================

function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return String(iso ?? ''); }
}

function renderLatest(row) {
    return `
        <div class="panel placement-latest">
            <h4 class="panel-title">ผลล่าสุด</h4>
            <p class="placement-badge-level">${esc(row.level)}</p>
            <p class="field-hint">${esc(formatDate(row.taken_at))} · คะแนน ${row.score}/100 · คำศัพท์โดยประมาณ ~${Number(row.vocab_size || 0).toLocaleString('th-TH')} คำ</p>
        </div>`;
}

function renderChart(rows) {
    const points = [...rows].reverse();   // oldest → newest
    const w = 280, h = 70, pad = 8;
    const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    const y = (lv) => h - pad - (LEVELS.indexOf(lv) / (LEVELS.length - 1)) * (h - pad * 2);
    const coords = points.map((p, i) => [pad + i * stepX, y(p.level)]);
    const line = coords.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
    const dots = coords.map(([x, yy], i) =>
        `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="3"><title>${esc(points[i].level)} · ${esc(formatDate(points[i].taken_at))}</title></circle>`
    ).join('');
    return `
        <div class="panel">
            <h4 class="panel-title">แนวโน้มระดับ</h4>
            <svg class="placement-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="กราฟแนวโน้มระดับภาษาอังกฤษ">
                <polyline points="${line}" />
                ${dots}
            </svg>
        </div>`;
}

function renderHistoryList(rows) {
    return `
        <div class="panel">
            <h4 class="panel-title">ประวัติการวัดระดับ</h4>
            <div class="placement-history-list">
                ${rows.map((row) => `
                    <div class="placement-history-row">
                        <span class="level-tag">${esc(row.level)}</span>
                        <span>${esc(formatDate(row.taken_at))}</span>
                        <span>${row.score}/100</span>
                        <span>~${Number(row.vocab_size || 0).toLocaleString('th-TH')} คำ</span>
                    </div>`).join('')}
            </div>
        </div>`;
}

function renderIntro() {
    const rows = history || [];
    const latest = rows[0];
    $().innerHTML = `
        <div class="panel">
            <h3 class="panel-title">วัดระดับภาษาอังกฤษ (CEFR)</h3>
            <p class="field-hint">แบบทดสอบคำศัพท์ทีละระดับตั้งแต่ A1 ถึง C2 ใช้เวลาประมาณ 5 นาที เพื่อประเมินระดับและจำนวนคำศัพท์ที่คุณรู้ในตอนนี้</p>
            <button class="btn btn-primary" data-action="start">เริ่มวัดระดับ</button>
        </div>
        ${latest ? renderLatest(latest) : ''}
        ${rows.length >= 2 ? renderChart(rows) : ''}
        ${rows.length ? renderHistoryList(rows) : ''}`;
}
