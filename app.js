/**
 * Oxford 3000 Flashcards — UI.
 *
 * The scheduling lives in Postgres (see api.js and supabase/migrations/).
 * This file is presentation and input handling only.
 */
import * as api from './api.js';

// ===================== STATE =====================
const state = {
    profile: null,
    stats: null,
    queue: [],
    index: 0,
    revealed: false,
    mode: 'flip',
    levels: [],
    pos: '',
    answering: false,
    signupMode: false
};

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.hidden = !on; };

// ===================== BOOT =====================
document.addEventListener('DOMContentLoaded', async () => {
    bindAuthUI();
    registerServiceWorker();

    const { data: { session } } = await api.supabase.auth.getSession();
    if (session) {
        await enterApp();
    } else {
        showLogin();
    }

    api.supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') location.reload();
    });

    window.addEventListener('online', async () => {
        setConn(true);
        const sent = await api.flushOutbox();
        if (sent) {
            toast(`ส่งผลทบทวนที่ค้างไว้ ${sent} รายการแล้ว`);
            refreshStats();
        }
    });
    window.addEventListener('offline', () => setConn(false));
});

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* not fatal */ });
}

// ===================== AUTH =====================
function bindAuthUI() {
    $('loginBtn').addEventListener('click', submitAuth);
    $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
    $('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password').focus(); });
    $('authSwitchBtn').addEventListener('click', toggleAuthMode);
}

function toggleAuthMode() {
    state.signupMode = !state.signupMode;
    $('authTitle').textContent = state.signupMode ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
    $('loginBtn').textContent = state.signupMode ? '✨ สมัครสมาชิก' : '🚀 เข้าสู่ระบบ';
    $('authSwitchText').textContent = state.signupMode ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?';
    $('authSwitchBtn').textContent = state.signupMode ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก';
    $('password').autocomplete = state.signupMode ? 'new-password' : 'current-password';
    authError('');
}

function authError(msg) {
    const el = $('authError');
    el.textContent = msg;
    show(el, Boolean(msg));
}

async function submitAuth() {
    const username = $('username').value.trim();
    const password = $('password').value;
    authError('');

    if (username.length < 3) return authError('ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');
    // Only new passwords have to clear the bar — accounts carried over from the
    // old spreadsheet have shorter ones and must still be able to sign in.
    if (state.signupMode && password.length < 8) return authError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    if (!password) return authError('กรุณากรอกรหัสผ่าน');

    const btn = $('loginBtn');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔄 กำลังดำเนินการ...';

    try {
        if (state.signupMode) {
            await api.signUp(username, password);
        } else {
            await api.signIn(username, password);
        }
        await enterApp();
    } catch (err) {
        authError(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

function showLogin() {
    show($('loginScreen'), true);
    show($('mainApp'), false);
}

async function enterApp() {
    show($('loginScreen'), false);
    show($('mainApp'), true);

    bindAppUI();
    restorePreferences();

    const [profile] = await Promise.all([api.getProfile(), refreshStats(), loadPosOptions()]);
    state.profile = profile;
    $('currentUsername').textContent = profile?.username || '-';
    $('dailyGoalInput').value = profile?.daily_goal || 20;

    api.flushOutbox().then((n) => { if (n) refreshStats(); });
}

// ===================== APP UI BINDING =====================
let bound = false;
function bindAppUI() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('.tab').forEach((tab) =>
        tab.addEventListener('click', () => switchView(tab.dataset.view)));

    $('logoutBtn').addEventListener('click', async () => {
        if (!confirm('🚪 ต้องการออกจากระบบใช่หรือไม่?')) return;
        await api.signOut();
        location.reload();
    });

    $('startBtn').addEventListener('click', startSession);
    $('skipBtn').addEventListener('click', skipCard);
    $('hideBtn').addEventListener('click', suspendCurrent);
    $('speakBtn').addEventListener('click', () => speak(currentWord()?.word));
    $('showTranslationToggle').addEventListener('change', (e) => reveal(e.target.checked));

    $('gradeRow').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-grade]');
        if (btn) grade(Number(btn.dataset.grade));
    });

    bindChips('levelChips', (levels) => { state.levels = levels; savePreferences(); startSession(); });
    bindChips('browseLevelChips', () => runSearch());

    $('posSelect').addEventListener('change', (e) => {
        state.pos = e.target.value; savePreferences(); startSession();
    });
    $('modeSelect').addEventListener('change', (e) => {
        state.mode = e.target.value; savePreferences(); if (state.queue.length) showCard();
    });

    $('viewHiddenBtn').addEventListener('click', openSuspendedModal);
    $('closeModalBtn').addEventListener('click', () => show($('hiddenModal'), false));
    $('hiddenModal').addEventListener('click', (e) => {
        if (e.target.id === 'hiddenModal') show($('hiddenModal'), false);
    });
    $('hiddenSearch').addEventListener('input', debounce(() => renderSuspended(), 250));
    $('hiddenWordsList').addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-unhide');
        if (btn) unsuspend(btn.dataset.wordId);
    });

    $('searchInput').addEventListener('input', debounce(() => runSearch(), 250));
    $('quizOptions').addEventListener('click', (e) => {
        const btn = e.target.closest('.quiz-option');
        if (btn) answerQuiz(btn);
    });
    $('typingInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') answerTyping(); });
    $('saveGoalBtn').addEventListener('click', saveGoal);

    document.addEventListener('keydown', onKey);
}

function bindChips(containerId, onChange) {
    const box = $(containerId);
    box.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        chip.classList.toggle('is-active');
        onChange(selectedChips(containerId));
    });
}

const selectedChips = (id) =>
    [...$(id).querySelectorAll('.chip.is-active')].map((c) => c.dataset.level);

function onKey(e) {
    if (!$('hiddenModal').hidden) {
        if (e.key === 'Escape') show($('hiddenModal'), false);
        return;
    }
    if (e.target.matches('input, select, textarea')) return;
    if ($('mainApp').hidden || $('studyView').hidden || !state.queue.length) return;

    if (e.key === ' ') { e.preventDefault(); reveal(!state.revealed); }
    else if (e.key.toLowerCase() === 's') speak(currentWord()?.word);
    else if (e.key.toLowerCase() === 'n') skipCard();
    else if (['1', '2', '3', '4'].includes(e.key) && state.mode === 'flip' && state.revealed) {
        grade([1, 3, 4, 5][Number(e.key) - 1]);
    }
}

// ===================== VIEWS =====================
function switchView(view) {
    document.querySelectorAll('.tab').forEach((t) =>
        t.classList.toggle('is-active', t.dataset.view === view));
    show($('studyView'), view === 'study');
    show($('browseView'), view === 'browse');
    show($('statsView'), view === 'stats');

    if (view === 'stats') renderStats();
    if (view === 'browse' && !$('browseResults').childElementCount) runSearch();
}

// ===================== PREFERENCES =====================
function savePreferences() {
    try {
        localStorage.setItem('flash_prefs', JSON.stringify({
            levels: state.levels, pos: state.pos, mode: state.mode
        }));
    } catch { /* ignore */ }
}

function restorePreferences() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('flash_prefs') || '{}'); } catch { /* ignore */ }
    state.levels = prefs.levels || [];
    state.pos = prefs.pos || '';
    state.mode = prefs.mode || 'flip';
    $('modeSelect').value = state.mode;
    state.levels.forEach((lv) => {
        const chip = $('levelChips').querySelector(`[data-level="${lv}"]`);
        if (chip) chip.classList.add('is-active');
    });
}

async function loadPosOptions() {
    try {
        const list = await api.getPosList();
        const sel = $('posSelect');
        list.forEach((row) => {
            const opt = document.createElement('option');
            opt.value = row.pos;
            opt.textContent = `${row.pos} (${row.n})`;
            sel.appendChild(opt);
        });
        sel.value = state.pos;
    } catch { /* filter stays "ทั้งหมด" */ }
}

// ===================== STUDY SESSION =====================
const currentWord = () => state.queue[state.index];

async function startSession() {
    const btn = $('startBtn');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังโหลด...';

    try {
        const [queue] = await Promise.all([
            api.getQueue({ levels: state.levels, pos: state.pos ? [state.pos] : null }),
            refreshStats()
        ]);
        state.queue = queue;
        state.index = 0;

        if (!queue.length) return showEmpty();

        show($('startBtn'), false);
        show($('cardActions'), true);
        showCard();
    } catch (err) {
        toast('โหลดคำไม่สำเร็จ: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 เริ่มทบทวน';
    }
}

function showCard() {
    const card = currentWord();
    if (!card) return reloadQueue();

    show($('flashcard'), true);
    show($('emptyState'), false);

    const word = card.word || '-';
    const wordEl = $('word');
    wordEl.textContent = word.charAt(0).toUpperCase() + word.slice(1);
    wordEl.removeAttribute('data-length');
    if (word.length > 15) wordEl.dataset.length = 'extra-long';
    else if (word.length > 12) wordEl.dataset.length = 'very-long';
    else if (word.length > 8) wordEl.dataset.length = 'long';

    setTag($('posTag'), card.pos);
    setTag($('levelTag'), card.level);
    $('pronunciationText').textContent = card.pronunciation || '—';
    $('translationText').textContent = card.translation || '—';
    $('cardSchedule').textContent = card.is_new
        ? '✨ คำใหม่'
        : `ทบทวนครั้งที่ ${card.repetitions} · ช่วงห่าง ${card.interval_days} วัน`;

    // grade buttons show what each answer will do to the schedule
    document.querySelectorAll('[data-hint]').forEach((el) => {
        const g = Number(el.dataset.hint);
        el.textContent = formatInterval(previewInterval(card, g));
    });

    state.revealed = false;
    $('showTranslationToggle').checked = false;
    show($('translationContent'), false);
    show($('gradeRow'), state.mode === 'flip');
    show($('flipControls'), state.mode === 'flip');
    show($('quizOptions'), state.mode === 'quiz');
    show($('typingBox'), state.mode === 'typing');
    $('typingInput').value = '';
    $('typingFeedback').textContent = '';

    if (state.mode === 'quiz') buildQuiz(card);
    if (state.mode === 'typing') $('typingInput').focus();
}

function setTag(el, value) {
    el.textContent = value || '';
    el.style.display = value ? 'inline-block' : 'none';
}

function reveal(on) {
    state.revealed = on;
    $('showTranslationToggle').checked = on;
    show($('translationContent'), on);
}

async function grade(value) {
    if (state.answering) return;
    const card = currentWord();
    if (!card) return;

    state.answering = true;
    // optimistic: the card leaves the queue immediately, the write happens behind it
    const wordId = card.id;
    advance();

    try {
        await api.reviewCardResilient(wordId, value, state.mode);
        bumpToday();
    } catch {
        setConn(false);
        toast('ออฟไลน์ — เก็บผลไว้ส่งทีหลังแล้ว');
    } finally {
        state.answering = false;
    }
    debouncedStats();
}

/** Drop the current card from the session — it has been answered. */
function advance() {
    state.queue.splice(state.index, 1);
    if (state.index >= state.queue.length) state.index = 0;
    if (!state.queue.length) return reloadQueue();
    showCard();
}

/** Skip: no grade recorded, the card goes to the back of the session. */
function skipCard() {
    if (state.queue.length < 2) return;
    const [card] = state.queue.splice(state.index, 1);
    state.queue.push(card);
    if (state.index >= state.queue.length) state.index = 0;
    showCard();
}

async function reloadQueue() {
    const queue = await api.getQueue({
        levels: state.levels, pos: state.pos ? [state.pos] : null
    }).catch(() => []);
    state.queue = queue;
    state.index = 0;
    await refreshStats();
    if (queue.length) showCard(); else showEmpty();
}

function showEmpty() {
    show($('flashcard'), false);
    show($('emptyState'), true);
    show($('cardActions'), false);
    show($('startBtn'), true);
    $('startBtn').textContent = '🔄 โหลดใหม่';

    const anyFilter = state.levels.length || state.pos;
    $('emptyTitle').textContent = anyFilter ? 'ไม่มีคำตามตัวกรองนี้' : 'ทบทวนครบแล้ววันนี้!';
    $('emptySub').textContent = anyFilter
        ? 'ลองเอาตัวกรองระดับหรือชนิดคำออก'
        : 'กลับมาใหม่เมื่อถึงรอบทบทวนถัดไป';
}

async function suspendCurrent() {
    const card = currentWord();
    if (!card) return;
    const btn = $('hideBtn');
    btn.disabled = true;
    try {
        await api.setSuspended(card.id, true);
        if (state.stats) { state.stats.suspended++; renderStudyStats(); }
        advance();
    } catch (err) {
        toast('บันทึกไม่สำเร็จ: ' + err.message);
    } finally {
        btn.disabled = false;
    }
}

// ===================== QUIZ MODE =====================
async function buildQuiz(card) {
    const box = $('quizOptions');
    box.innerHTML = '<p class="loading">กำลังเตรียมตัวเลือก...</p>';
    let options = [];
    try {
        options = await api.getQuizOptions(card.id);
    } catch { /* fall back to a plain reveal below */ }

    if (currentWord()?.id !== card.id) return; // user moved on while loading

    if (!options.length || !card.translation) {
        box.innerHTML = '';
        show($('gradeRow'), true);
        reveal(true);
        return;
    }

    const choices = shuffle([
        { text: card.translation, correct: true },
        ...options.map((o) => ({ text: o.translation, correct: false }))
    ]);

    box.innerHTML = '';
    choices.forEach((c) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option';
        btn.textContent = c.text;
        btn.dataset.correct = String(c.correct);
        box.appendChild(btn);
    });
}

function answerQuiz(btn) {
    if (btn.closest('.quiz-options').classList.contains('is-answered')) return;
    const box = $('quizOptions');
    box.classList.add('is-answered');

    const correct = btn.dataset.correct === 'true';
    box.querySelectorAll('.quiz-option').forEach((el) => {
        if (el.dataset.correct === 'true') el.classList.add('is-correct');
        else if (el === btn) el.classList.add('is-wrong');
    });

    setTimeout(() => {
        box.classList.remove('is-answered');
        grade(correct ? 4 : 1);
    }, correct ? 550 : 1400);
}

// ===================== TYPING MODE =====================
function answerTyping() {
    const card = currentWord();
    if (!card) return;
    const input = $('typingInput');
    const guess = normalise(input.value);
    if (!guess) return;

    const answers = (card.translation || '').split(/[\/,;|]/).map(normalise).filter(Boolean);
    const correct = answers.some((a) => a === guess || (a.length > 3 && a.includes(guess)));

    $('typingFeedback').textContent = correct
        ? '✅ ถูกต้อง'
        : `❌ คำตอบคือ ${card.translation || '—'}`;
    $('typingFeedback').className = 'typing-feedback ' + (correct ? 'is-correct' : 'is-wrong');

    input.disabled = true;
    setTimeout(() => {
        input.disabled = false;
        grade(correct ? 4 : 1);
    }, correct ? 700 : 1800);
}

const normalise = (s) => (s || '').toLowerCase().replace(/[\s.()"'’]/g, '').trim();

// ===================== SM-2 PREVIEW =====================
// Mirrors public.sm2_next in supabase/migrations/0002_sm2_rpc.sql — display only.
// The database is always the authority; this just labels the buttons.
function previewInterval(card, grade) {
    const ef = Math.max(1.3, Number(card.ease_factor || 2.5) +
        (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    const reps = Number(card.repetitions || 0);
    if (grade < 3) return 1;
    if (reps <= 0) return 1;
    if (reps === 1) return 6;
    return Math.max(1, Math.round(Number(card.interval_days || 0) * ef));
}

function formatInterval(days) {
    if (days < 1) return '<1 วัน';
    if (days === 1) return 'พรุ่งนี้';
    if (days < 30) return `${days} วัน`;
    if (days < 365) return `${Math.round(days / 30)} เดือน`;
    return `${(days / 365).toFixed(1)} ปี`;
}

// ===================== STATS =====================
const debouncedStats = debounce(() => refreshStats(), 1200);

async function refreshStats() {
    try {
        state.stats = await api.getStats();
        renderStudyStats();
        if (!$('statsView').hidden) renderStats();
        setConn(true);
    } catch {
        setConn(false);
    }
}

function bumpToday() {
    if (!state.stats) return;
    state.stats.today = (state.stats.today || 0) + 1;
    renderStudyStats();
}

function renderStudyStats() {
    const s = state.stats;
    if (!s) return;
    $('dueCount').textContent = s.due_now ?? 0;
    $('remainingCount').textContent = Math.max(0, s.remaining ?? 0);
    $('hiddenWordsCount').textContent = s.suspended ?? 0;
    $('streakCount').textContent = s.streak ?? 0;

    const goal = s.daily_goal || 20;
    const done = s.today || 0;
    $('goalFill').style.width = Math.min(100, (done / goal) * 100) + '%';
    $('goalText').textContent = `วันนี้ ${done} / ${goal} คำ` + (done >= goal ? ' 🎉' : '');
}

function renderStats() {
    const s = state.stats;
    if (!s) return;
    $('sLearning').textContent = s.learning ?? 0;
    $('sReview').textContent = s.in_review ?? 0;
    $('sMastered').textContent = s.mastered ?? 0;
    $('sSuspended').textContent = s.suspended ?? 0;
    $('sStreak').textContent = s.streak ?? 0;
    $('sToday').textContent = s.today ?? 0;

    renderLevelBars(s.by_level || {});
    renderHeatmap(s.heatmap || {});
}

// Oxford 3000 only reaches B2; anything else lands in "อื่นๆ".
const LEVEL_TOTALS = { A1: 751, A2: 751, B1: 767, B2: 727 };

function renderLevelBars(byLevel) {
    const box = $('levelBars');
    box.innerHTML = '';
    Object.entries(LEVEL_TOTALS).forEach(([level, total]) => {
        const done = byLevel[level] || 0;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const row = document.createElement('div');
        row.className = 'level-bar';
        row.innerHTML = `
            <span class="level-bar-name">${level}</span>
            <span class="level-bar-track"><span class="level-bar-fill" style="width:${pct}%"></span></span>
            <span class="level-bar-value">${done}/${total}</span>`;
        box.appendChild(row);
    });
}

function renderHeatmap(map) {
    const box = $('heatmap');
    box.innerHTML = '';

    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 363);
    start.setDate(start.getDate() - start.getDay()); // align to Sunday

    const frag = document.createDocumentFragment();
    for (let week = 0; week < 53; week++) {
        const col = document.createElement('div');
        col.className = 'hm-week';
        for (let day = 0; day < 7; day++) {
            const d = new Date(start);
            d.setDate(start.getDate() + week * 7 + day);
            const cell = document.createElement('i');
            if (d > today) {
                cell.className = 'hm-future';
            } else {
                const key = d.toISOString().slice(0, 10);
                const n = map[key] || 0;
                cell.className = 'hm-' + (n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 35 ? 3 : 4);
                cell.title = `${key} · ${n} คำ`;
            }
            col.appendChild(cell);
        }
        frag.appendChild(col);
    }
    box.appendChild(frag);
}

async function saveGoal() {
    const goal = Number($('dailyGoalInput').value);
    if (!goal || goal < 1 || goal > 500) return toast('เป้าหมายต้องอยู่ระหว่าง 1–500');
    try {
        await api.saveDailyGoal(goal);
        if (state.stats) state.stats.daily_goal = goal;
        renderStudyStats();
        toast('บันทึกเป้าหมายแล้ว');
    } catch (err) {
        toast('บันทึกไม่สำเร็จ: ' + err.message);
    }
}

// ===================== BROWSE =====================
async function runSearch() {
    const box = $('browseResults');
    const query = $('searchInput').value.trim();
    const levels = selectedChips('browseLevelChips');
    box.innerHTML = '<p class="loading">กำลังค้นหา...</p>';

    let rows = [];
    try {
        rows = await api.searchWords(query, levels);
    } catch (err) {
        box.innerHTML = `<p class="empty-message">ค้นหาไม่สำเร็จ: ${err.message}</p>`;
        return;
    }

    if (!rows.length) {
        box.innerHTML = '<p class="empty-message">ไม่พบคำที่ตรงกับการค้นหา</p>';
        return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
        const item = document.createElement('div');
        item.className = 'word-row';
        item.innerHTML = `
            <div class="word-row-main">
                <strong>${escapeHtml(row.word)}</strong>
                <span class="translation-small">${escapeHtml(row.translation || '—')}</span>
            </div>
            <div class="word-row-meta">
                ${row.level ? `<span class="level-tag">${row.level}</span>` : ''}
                <span class="status-badge status-${row.status}">${STATUS_TH[row.status] || row.status}</span>
            </div>`;
        frag.appendChild(item);
    });
    box.innerHTML = '';
    box.appendChild(frag);
}

const STATUS_TH = {
    new: 'ยังไม่เรียน', learning: 'กำลังเรียน', review: 'ทบทวน',
    mastered: 'แม่นแล้ว', suspended: 'จำได้แล้ว'
};

// ===================== SUSPENDED MODAL =====================
async function openSuspendedModal() {
    show($('hiddenModal'), true);
    $('hiddenSearch').value = '';
    await renderSuspended();
}

async function renderSuspended() {
    const box = $('hiddenWordsList');
    box.innerHTML = `<div class="loading-skeleton">
        <div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div>
    </div>`;

    let words = [];
    try {
        words = await api.getSuspendedWords($('hiddenSearch').value.trim());
    } catch (err) {
        box.innerHTML = `<p class="empty-message">โหลดไม่สำเร็จ: ${err.message}</p>`;
        return;
    }

    if (!words.length) {
        box.innerHTML = '<p class="empty-message">ไม่มีคำในรายการนี้</p>';
        return;
    }

    const frag = document.createDocumentFragment();
    const badge = document.createElement('div');
    badge.className = 'learned-count-badge';
    badge.innerHTML = `<span class="count-icon">🎯</span>
        <span class="count-text">จำได้แล้ว</span>
        <span class="count-number">${words.length}</span>`;
    frag.appendChild(badge);

    const list = document.createElement('div');
    list.className = 'hidden-words-list';
    words.forEach((w) => {
        const item = document.createElement('div');
        item.className = 'hidden-word-item';
        item.dataset.wordId = w.id;
        item.innerHTML = `
            <div class="word-info">
                <strong>${escapeHtml(w.word)}</strong>
                <span class="translation-small">${escapeHtml(w.translation || '—')}</span>
            </div>
            <button class="btn btn-unhide" data-word-id="${w.id}">ยกเลิกการจำ</button>`;
        list.appendChild(item);
    });
    frag.appendChild(list);

    box.innerHTML = '';
    box.appendChild(frag);
}

async function unsuspend(wordId) {
    try {
        await api.setSuspended(wordId, false);
        const item = $('hiddenWordsList').querySelector(`.hidden-word-item[data-word-id="${wordId}"]`);
        if (item) item.remove();
        if (state.stats && state.stats.suspended > 0) state.stats.suspended--;
        renderStudyStats();

        const badge = document.querySelector('.learned-count-badge .count-number');
        const left = $('hiddenWordsList').querySelectorAll('.hidden-word-item').length;
        if (badge) badge.textContent = left;
        if (!left) $('hiddenWordsList').innerHTML = '<p class="empty-message">ไม่มีคำในรายการนี้</p>';
    } catch (err) {
        toast('ยกเลิกไม่สำเร็จ: ' + err.message);
    }
}

// ===================== SPEECH =====================
let englishVoice = null;

function pickVoice() {
    if (englishVoice || !window.speechSynthesis) return englishVoice;
    const voices = speechSynthesis.getVoices();
    englishVoice = voices.find((v) => /en[-_](GB|US)/i.test(v.lang) && /google|natural|premium/i.test(v.name))
        || voices.find((v) => /^en[-_]/i.test(v.lang))
        || null;
    return englishVoice;
}

if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = () => { englishVoice = null; pickVoice(); };
}

function speak(text) {
    if (!text || !window.speechSynthesis) return;
    // "bank (money)" is a disambiguator for the reader, not something to say
    const spoken = text.replace(/\s*\([^)]*\)/g, '').trim();
    if (!spoken) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(spoken);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang || 'en-US';
    utter.rate = 0.9;
    speechSynthesis.speak(utter);
}

// ===================== UTILITIES =====================
function setConn(ok) {
    const el = $('connStatus');
    const pending = api.outboxSize();
    el.className = ok ? 'conn-ok' : 'conn-off';
    el.textContent = ok
        ? 'เชื่อมต่อแล้ว'
        : `ออฟไลน์${pending ? ` · ค้างส่ง ${pending}` : ''}`;
}

let toastTimer = null;
function toast(message) {
    const el = $('toast');
    el.textContent = message;
    show(el, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(el, false), 3200);
}

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
