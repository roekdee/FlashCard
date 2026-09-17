/**
 * Oxford 3000 Flashcards — UI.
 *
 * The scheduling and the Free/Pro limits live in Postgres (see api.js and
 * supabase/migrations/). This file is presentation and input handling: where it
 * hides a control for a Free account it is a courtesy, not the gate — the
 * database refuses the call regardless.
 */
import * as api from './api.js?v=dev';

// ===================== STATE =====================
const state = {
    account: null,
    stats: null,
    billing: null,
    queue: [],
    index: 0,
    revealed: false,
    mode: 'flip',
    levels: [],
    pos: '',
    answering: false,
    authMode: 'signin',
    selectedPlan: null,
    payMethod: 'promptpay',
    intent: null,
    rankMetric: 'week'
};

const $ = (id) => document.getElementById(id);
const show = (el, on) => { if (el) el.hidden = !on; };
const isPro = () => Boolean(state.account?.is_pro ?? state.stats?.is_pro);
const allowedModes = () => state.stats?.modes || ['flip'];
const allowedLevels = () => state.stats?.levels || null;

// ===================== BOOT =====================
document.addEventListener('DOMContentLoaded', async () => {
    bindAuthUI();
    registerServiceWorker();
    applyPublicConfig();

    // An OAuth round trip that fails comes back as fragment parameters rather
    // than a rejected promise, so read them before anything clears the hash.
    const redirectError = takeRedirectError();

    // Supabase puts the recovery session in the URL fragment before we get here.
    const recovering = location.hash.includes('type=recovery') || location.hash === '#reset';

    api.supabase.auth.onAuthStateChange(async (event) => {
        if (event === 'SIGNED_OUT') return location.reload();
        if (event === 'PASSWORD_RECOVERY') return showReset();
        if (event === 'SIGNED_IN' && $('mainApp').hidden && !recovering) await enterApp();
    });

    const { data: { session } } = await api.supabase.auth.getSession();
    if (recovering && session) showReset();
    else if (session) await enterApp();
    else {
        showLogin();                            // resets the form, so report after
        if (redirectError) authError(redirectError);
    }

    window.addEventListener('online', async () => {
        setConn(true);
        const sent = await api.flushOutbox();
        if (sent) { toast(`ส่งผลทบทวนที่ค้างไว้ ${sent} รายการแล้ว`); refreshStats(); }
    });
    window.addEventListener('offline', () => setConn(false));
});

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* not fatal */ });
}

/**
 * Read an OAuth failure out of the URL and clear it.
 *
 * A failed round trip comes back as fragment parameters rather than a rejected
 * promise, so there is nothing to catch — the message has to be picked up here.
 */
function takeRedirectError() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const code = params.get('error') || params.get('error_code');
    if (!code) return null;

    const detail = decodeURIComponent((params.get('error_description') || '').replace(/\+/g, ' '));
    history.replaceState(null, '', location.pathname);

    if (/provider/i.test(detail) || /provider/i.test(code)) {
        return 'ยังไม่ได้เปิดใช้งาน Google login — เข้าสู่ระบบด้วยอีเมลไปก่อน';
    }
    return detail || 'เข้าสู่ระบบไม่สำเร็จ';
}

/**
 * Hide the sign-in options the project has not been configured for.
 *
 * Google was shown unconditionally, so before the provider was enabled in the
 * Supabase dashboard the button just produced "provider is not enabled".
 */
/**
 * Every provider the app knows how to label. A name the project has enabled
 * but this table does not cover still gets a button, just a plain one.
 */
const OAUTH_LABELS = {
    google: { name: 'Google', svg:
        '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/>'
      + '<path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z"/>'
      + '<path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/>'
      + '<path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"/>' },
    facebook: { name: 'Facebook', svg:
        '<path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/>' },
    apple: { name: 'Apple', svg:
        '<path fill="currentColor" d="M17.6 12.7c0-2.7 2.2-4 2.3-4.1-1.2-1.8-3.2-2-3.9-2.1-1.6-.2-3.2 1-4 1-.8 0-2.1-1-3.5-1-1.8 0-3.5 1.1-4.4 2.7-1.9 3.2-.5 8 1.3 10.6.9 1.3 2 2.7 3.4 2.7 1.4-.1 1.9-.9 3.5-.9 1.7 0 2.1.9 3.5.8 1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3-.1 0-2.9-1.1-3-4.1zM15 4.6c.7-.9 1.2-2.1 1.1-3.4-1.1 0-2.4.7-3.2 1.7-.7.8-1.3 2.1-1.1 3.3 1.2.1 2.4-.6 3.2-1.6z"/>' },
    github: { name: 'GitHub', svg:
        '<path fill="currentColor" d="M12 0a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.500-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.2 4.7 18.2 5 18.2 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 0z"/>' },
    discord: { name: 'Discord', svg:
        '<path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.6a18.3 18.3 0 0 1 4.4 1.4 17.9 17.9 0 0 0-15 0A18.3 18.3 0 0 1 8.9 3.6L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9-.3 13.6.2 18.1a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.3-2.1 13 13 0 0 1-2-1c.2-.1.3-.2.5-.4a14.2 14.2 0 0 0 12.1 0l.5.4a13 13 0 0 1-2 1c.4.7.8 1.4 1.3 2.1a19.9 19.9 0 0 0 6-3c.6-5.2-.8-9.8-3.6-13.7zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/>' },
    line: { name: 'LINE', svg:
        '<path fill="#06C755" d="M12 2C6.5 2 2 5.6 2 10.1c0 4 3.6 7.4 8.4 8 .3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 6-3.5 8.2-6 1.5-1.6 2.2-3.3 2.2-5C22 5.6 17.5 2 12 2z"/>' },
    azure:    { name: 'Microsoft' },
    kakao:    { name: 'Kakao' },
    twitter:  { name: 'X' },
    linkedin_oidc: { name: 'LinkedIn' }
};

async function applyPublicConfig() {
    renderOAuthButtons([]);
    try {
        state.billing = await api.getBillingConfig();
    } catch {
        return;   // leave the email form working on its own
    }
    renderOAuthButtons(state.billing.oauth_providers || []);
}

/** A button per enabled provider, and no divider when there are none. */
function renderOAuthButtons(providers) {
    const box = $('oauthButtons');
    box.textContent = '';
    show($('oauthDivider'), providers.length > 0);

    for (const provider of providers) {
        const { name, svg } = OAUTH_LABELS[provider] || { name: provider };
        const btn = document.createElement('button');
        btn.className = 'btn btn-oauth btn-large';
        if (svg) {
            // The markup is ours, not the provider's — nothing user supplied
            // reaches innerHTML here.
            const mark = document.createElement('span');
            mark.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">${svg}</svg>`;
            btn.appendChild(mark.firstChild);
        }
        btn.appendChild(document.createTextNode(`ดำเนินการต่อด้วย ${name}`));
        btn.addEventListener('click', async () => {
            try { await api.signInWithProvider(provider); }
            catch (err) { authError(err.message); }
        });
        box.appendChild(btn);
    }
}

// ===================== AUTH =====================
function bindAuthUI() {
    $('authTabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.auth-tab');
        if (tab) setAuthMode(tab.dataset.mode);
    });
    $('submitAuthBtn').addEventListener('click', submitAuth);
    $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
    $('identifier').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password').focus(); });
    $('forgotBtn').addEventListener('click', showForgot);
    $('forgotSubmitBtn').addEventListener('click', sendReset);
    $('forgotEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReset(); });
    $('backToLoginBtn').addEventListener('click', showLogin);
    $('resetSubmitBtn').addEventListener('click', submitReset);
}

function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === 'signup';
    document.querySelectorAll('.auth-tab').forEach((t) =>
        t.classList.toggle('is-active', t.dataset.mode === mode));

    show($('usernameGroup'), signup);
    $('identifierLabel').textContent = '📧 อีเมล';
    $('identifier').type = 'email';
    $('identifier').placeholder = 'you@example.com';
    $('identifierHint').textContent = signup
        ? 'ใช้กู้รหัสผ่านและรับใบเสร็จ'
        : 'บัญชีเดิมใช้ชื่อผู้ใช้ก็ได้';
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('submitAuthBtn').textContent = signup ? '✨ สมัครสมาชิก' : '🚀 เข้าสู่ระบบ';
    show($('forgotBtn').parentElement, !signup);
    authError('');
    authNotice('');
}

const authError = (msg) => { $('authError').textContent = msg; show($('authError'), Boolean(msg)); };
const authNotice = (msg) => { $('authNotice').textContent = msg; show($('authNotice'), Boolean(msg)); };

async function submitAuth() {
    const identifier = $('identifier').value.trim();
    const password = $('password').value;
    const signup = state.authMode === 'signup';
    authError(''); authNotice('');

    if (!identifier) return authError('กรอกอีเมลก่อน');
    if (signup && !/\S+@\S+\.\S+/.test(identifier)) return authError('กรอกอีเมลให้ถูกต้อง');
    if (signup && password.length < 8) return authError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    if (!password) return authError('กรอกรหัสผ่าน');

    const username = $('signupUsername').value.trim().toLowerCase();
    if (signup) {
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            return authError('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, _ และยาว 3-32 ตัวอักษร');
        }
        const free = await api.usernameAvailable(username).catch(() => true);
        if (!free) return authError('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    }

    const btn = $('submitAuthBtn');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔄 กำลังดำเนินการ...';

    try {
        if (signup) {
            const { needsConfirmation } = await api.signUp({ email: identifier, password, username });
            if (needsConfirmation) {
                // Leaving them on the sign-up form made it look like nothing
                // happened. Move to sign-in, keep the address, say what to do.
                setAuthMode('signin');
                $('identifier').value = identifier;
                $('password').value = '';
                authNotice(`ส่งลิงก์ยืนยันไปที่ ${identifier} แล้ว — กดลิงก์ในเมล `
                    + '(เช็คโฟลเดอร์ Promotions/Spam ด้วย) แล้วเข้าสู่ระบบตรงนี้ได้เลย');
                return;
            }
        } else {
            await api.signIn(identifier, password);
        }
        await enterApp();
    } catch (err) {
        authError(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

const forgotError = (msg) => { $('forgotError').textContent = msg; show($('forgotError'), Boolean(msg)); };
const forgotNotice = (msg) => { $('forgotNotice').textContent = msg; show($('forgotNotice'), Boolean(msg)); };

/** The link on the sign-in form. Carries over whatever was typed there. */
function showForgot() {
    show($('loginScreen'), false);
    show($('resetScreen'), false);
    show($('mainApp'), false);
    show($('forgotScreen'), true);
    const typed = $('identifier').value.trim();
    $('forgotEmail').value = /\S+@\S+\.\S+/.test(typed) ? typed : '';
    forgotError(''); forgotNotice('');
    $('forgotEmail').focus();
}

async function sendReset() {
    const email = $('forgotEmail').value.trim();
    forgotError(''); forgotNotice('');
    if (!/\S+@\S+\.\S+/.test(email)) return forgotError('กรอกอีเมลให้ถูกต้อง');

    const btn = $('forgotSubmitBtn');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🔄 กำลังส่ง...';
    try {
        await api.sendPasswordReset(email);
        // Say the same thing whether or not the address exists, so this cannot
        // be used to find out who has an account here.
        forgotNotice(`ถ้ามีบัญชีที่ใช้ ${email} เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว `
            + '— เช็คโฟลเดอร์ Promotions/Spam ด้วย');
    } catch (err) {
        forgotError(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

function showLogin() {
    show($('loginScreen'), true);
    show($('forgotScreen'), false);
    show($('resetScreen'), false);
    show($('mainApp'), false);
    setAuthMode('signin');
}

function showReset() {
    show($('loginScreen'), false);
    show($('forgotScreen'), false);
    show($('mainApp'), false);
    show($('resetScreen'), true);
}

async function submitReset() {
    const password = $('resetPassword').value;
    const err = $('resetError');
    if (password.length < 8) {
        err.textContent = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
        return show(err, true);
    }
    show(err, false);
    try {
        await api.setNewPassword(password);
        history.replaceState(null, '', location.pathname);
        toast('เปลี่ยนรหัสผ่านแล้ว');
        await enterApp();
    } catch (e) {
        err.textContent = e.message;
        show(err, true);
    }
}

async function enterApp() {
    show($('loginScreen'), false);
    show($('forgotScreen'), false);
    show($('resetScreen'), false);
    show($('mainApp'), true);
    if (location.hash) history.replaceState(null, '', location.pathname);

    bindAppUI();
    restorePreferences();

    const [account] = await Promise.all([
        api.getAccount().catch(() => null),
        refreshStats(),
        loadPosOptions()
    ]);
    state.account = account;
    applyAccount();

    api.flushOutbox().then((n) => { if (n) refreshStats(); });
}

function applyAccount() {
    const a = state.account;
    if (!a) return;
    $('currentUsername').textContent = a.username || '-';
    $('usernameInput').value = a.username || '';
    $('emailInput').value = a.email || '';
    $('leaderboardToggle').checked = Boolean(a.show_on_leaderboard);
    $('dailyGoalInput').value = a.daily_goal ?? 20;
    $('newPerDayInput').value = a.new_per_day ?? 20;

    show($('emailBanner'), Boolean(a.needs_email));
    show($('planPill'), Boolean(a.is_pro));

    $('accountRows').innerHTML = `
        <div class="account-row"><span>อีเมล</span><strong>${escapeHtml(a.email || 'ยังไม่ได้ตั้ง')}</strong></div>
        <div class="account-row"><span>เข้าสู่ระบบด้วย</span><strong>${escapeHtml(a.provider || 'email')}</strong></div>
        <div class="account-row"><span>แพ็กเกจ</span><strong>${a.is_pro ? 'Pro' : 'Free'}</strong></div>
        ${a.pro_until ? `<div class="account-row"><span>Pro ถึง</span><strong>${formatDate(a.pro_until)}</strong></div>` : ''}`;
}

// ===================== APP UI =====================
let bound = false;
function bindAppUI() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('.tab').forEach((tab) =>
        tab.addEventListener('click', () => switchView(tab.dataset.view)));
    document.querySelectorAll('[data-goto-pro]').forEach((b) =>
        b.addEventListener('click', () => switchView('pro')));
    $('emptyUpgradeBtn').addEventListener('click', () => switchView('pro'));

    $('logoutBtn').addEventListener('click', async () => {
        if (!confirm('🚪 ต้องการออกจากระบบใช่หรือไม่?')) return;
        await api.signOut();
        location.reload();
    });

    $('startBtn').addEventListener('click', startSession);
    $('skipBtn').addEventListener('click', skipCard);
    $('undoBtn').addEventListener('click', undoLast);
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
    $('modeSelect').addEventListener('change', onModeChange);

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
    $('changePasswordBtn').addEventListener('click', changePassword);
    $('saveUsernameBtn').addEventListener('click', saveUsername);
    $('saveEmailBtn').addEventListener('click', saveEmail);
    $('bannerAddEmail').addEventListener('click', () => {
        switchView('stats');
        $('emailInput').scrollIntoView({ block: 'center' });
        $('emailInput').focus();
    });
    $('leaderboardToggle').addEventListener('change', async (e) => {
        try {
            await api.saveSettings({ showOnLeaderboard: e.target.checked });
            toast(e.target.checked ? 'จะแสดงชื่อบนกระดานแล้ว' : 'ซ่อนชื่อจากกระดานแล้ว');
        } catch (err) { toast(err.message); }
    });

    bindChips('metricChips', null, (chip) => {
        document.querySelectorAll('#metricChips .chip').forEach((c) =>
            c.classList.toggle('is-active', c === chip));
        state.rankMetric = chip.dataset.metric;
        renderLeaderboard();
    });

    bindChips('payMethodChips', null, (chip) => {
        document.querySelectorAll('#payMethodChips .chip').forEach((c) =>
            c.classList.toggle('is-active', c === chip));
        state.payMethod = chip.dataset.method;
        show($('cardForm'), state.payMethod === 'card');
    });

    $('planGrid').addEventListener('click', (e) => {
        const card = e.target.closest('.plan-card');
        if (!card) return;
        state.selectedPlan = card.dataset.code;
        document.querySelectorAll('.plan-card').forEach((c) =>
            c.classList.toggle('is-selected', c === card));
        show($('payPanel'), true);
        $('payNote').textContent = card.dataset.note || '';
    });
    $('payBtn').addEventListener('click', pay);
    $('slipBtn').addEventListener('click', submitSlip);

    document.addEventListener('keydown', onKey);
}

/** Multi-select chips by default; pass onPick for single-select behaviour. */
function bindChips(containerId, onChange, onPick) {
    const box = $(containerId);
    if (!box) return;
    box.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip || chip.disabled) return;
        if (onPick) return onPick(chip);
        chip.classList.toggle('is-active');
        onChange(selectedChips(containerId));
    });
}

const selectedChips = (id) =>
    [...$(id).querySelectorAll('.chip.is-active')].map((c) => c.dataset.level).filter(Boolean);

function onModeChange(e) {
    const mode = e.target.value;
    if (!allowedModes().includes(mode)) {
        e.target.value = state.mode;
        toast('โหมดนี้ใช้ได้เฉพาะสมาชิก Pro');
        return switchView('pro');
    }
    state.mode = mode;
    savePreferences();
    if (state.queue.length) showCard();
}

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
    else if (e.key.toLowerCase() === 'z' && !$('undoBtn').disabled) undoLast();
    else if (['1', '2', '3', '4'].includes(e.key) && state.mode === 'flip' && state.revealed) {
        grade([1, 3, 4, 5][Number(e.key) - 1]);
    }
}

// ===================== VIEWS =====================
function switchView(view) {
    document.querySelectorAll('.tab').forEach((t) =>
        t.classList.toggle('is-active', t.dataset.view === view));
    ['study', 'browse', 'stats', 'rank', 'pro'].forEach((name) =>
        show($(name + 'View'), name === view));

    if (view === 'stats') { renderStats(); renderBadges(); }
    if (view === 'rank') renderLeaderboard();
    if (view === 'pro') renderPro();
    if (view === 'browse' && !$('browseResults').childElementCount) runSearch();
}

// ===================== PLAN GATING (cosmetic; the DB is the gate) =====================
function applyPlanToUI() {
    const modes = allowedModes();
    [...$('modeSelect').options].forEach((opt) => {
        const locked = !modes.includes(opt.value);
        opt.disabled = locked;
        opt.textContent = opt.textContent.replace(/ 🔒$/, '') + (locked ? ' 🔒' : '');
    });
    if (!modes.includes(state.mode)) {
        state.mode = 'flip';
        $('modeSelect').value = 'flip';
    }

    const levels = allowedLevels();
    $('levelChips').querySelectorAll('.chip').forEach((chip) => {
        const locked = Boolean(levels) && !levels.includes(chip.dataset.level);
        chip.disabled = locked;
        chip.classList.toggle('is-locked', locked);
        chip.title = locked ? 'ระดับนี้ใช้ได้เฉพาะสมาชิก Pro' : '';
        if (locked) chip.classList.remove('is-active');
    });

    const pro = isPro();
    show($('planPill'), pro);
    show($('streakTile'), pro);
    show($('forecastLock'), !pro);
    show($('forecastBars'), pro);
    show($('heatmapLock'), !pro);
    show($('heatmap'), pro);
    document.querySelector('.heatmap-legend').hidden = !pro;
    $('newPerDayHint').textContent = pro
        ? '“คำใหม่ต่อวัน” คือเพดานคำที่ยังไม่เคยเห็น กันไม่ให้กองทบทวนพอกจนตามไม่ทัน'
        : 'บัญชีฟรีจำกัดคำใหม่ไว้ 10 คำต่อวัน — ตั้งได้สูงกว่านี้เมื่อเป็น Pro';
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

// ===================== STUDY =====================
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

    const hasExample = Boolean(card.example_en);
    show($('exampleBlock'), hasExample);
    if (hasExample) {
        $('exampleEn').textContent = card.example_en;
        $('exampleTh').textContent = card.example_th || '';
    }

    document.querySelectorAll('[data-hint]').forEach((el) => {
        el.textContent = formatInterval(previewInterval(card, Number(el.dataset.hint)));
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
    const wordId = card.id;
    advance();

    try {
        await api.reviewCardResilient(wordId, value, state.mode);
        bumpToday();
        $('undoBtn').disabled = false;
    } catch (err) {
        if (/Pro/i.test(err.message)) {
            toast(err.message);
            switchView('pro');
        } else {
            setConn(false);
            toast('ออฟไลน์ — เก็บผลไว้ส่งทีหลังแล้ว');
        }
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

    // Say why the queue is empty. Blaming the filter when the real cause is the
    // daily new-card budget sends people to the wrong control.
    const s = state.stats || {};
    const budgetSpent = (s.new_today ?? 0) >= (s.new_per_day ?? 20);
    const nothingDue = (s.due_now ?? 0) === 0;
    const anyFilter = state.levels.length || state.pos;
    const free = !isPro();

    let title, sub, offerPro = false;
    if ((s.remaining ?? 1) <= 0) {
        title = free ? 'เรียนครบทุกคำในระดับฟรีแล้ว!' : 'เรียนครบทุกคำแล้ว!';
        sub = free ? 'ปลดล็อก B1 และ B2 อีก 1,513 คำด้วย Pro' : 'ไม่เหลือคำใหม่ในคลังอีกแล้ว';
        offerPro = free;
    } else if (nothingDue && budgetSpent) {
        title = 'ครบโควตาคำใหม่ของวันนี้แล้ว';
        sub = free
            ? `บัญชีฟรีเปิดคำใหม่ได้วันละ ${s.new_per_day} คำ · Pro ไม่จำกัด`
            : `วันนี้เปิดคำใหม่ไป ${s.new_today} คำ (เพดาน ${s.new_per_day}) · `
              + 'อยากเรียนต่อวันนี้ ไปเพิ่ม "คำใหม่ต่อวัน" ที่แท็บสถิติ';
        offerPro = free;
    } else if (anyFilter) {
        title = 'ไม่มีคำตามตัวกรองนี้';
        sub = 'ลองเอาตัวกรองระดับหรือชนิดคำออก';
    } else {
        title = 'ทบทวนครบแล้ววันนี้!';
        sub = 'กลับมาใหม่เมื่อถึงรอบทบทวนถัดไป';
    }
    $('emptyTitle').textContent = title;
    $('emptySub').textContent = sub;
    show($('emptyUpgradeBtn'), offerPro);
}

/** Put the last answer back — the card returns to the deck. */
async function undoLast() {
    const btn = $('undoBtn');
    btn.disabled = true;
    try {
        const result = await api.undoLastReview();
        if (!result?.ok) return toast(result?.error || 'ย้อนกลับไม่สำเร็จ');

        toast(`ย้อน "${result.word}" กลับแล้ว`);
        await reloadQueue();

        const index = state.queue.findIndex((card) => card.id === result.word_id);
        if (index > -1) { state.index = index; showCard(); }
    } catch (err) {
        toast('ย้อนกลับไม่สำเร็จ: ' + err.message);
        btn.disabled = false;
    }
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

// ===================== QUIZ =====================
async function buildQuiz(card) {
    const box = $('quizOptions');
    box.innerHTML = '<p class="loading">กำลังเตรียมตัวเลือก...</p>';
    let options = [];
    try { options = await api.getQuizOptions(card.id); }
    catch { /* fall back to a plain reveal below */ }

    if (currentWord()?.id !== card.id) return;   // user moved on while loading

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
    const box = $('quizOptions');
    if (box.classList.contains('is-answered')) return;
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

// ===================== TYPING =====================
function answerTyping() {
    const card = currentWord();
    if (!card) return;
    const input = $('typingInput');
    const guess = normalise(input.value);
    if (!guess) return;

    const correct = isAcceptableAnswer(guess, card.translation);

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

/**
 * Accept a typed answer against a gloss like "ปิด (ทำให้สนิท) / งับ".
 *
 * The old rule was `sense.includes(guess)` for any sense over three characters,
 * which passed a single Thai letter as a correct answer and fed SM-2 a lie.
 * Now a sense matches on equality, or on a near-complete prefix — enough to
 * forgive a dropped final syllable, not enough to guess.
 */
function isAcceptableAnswer(guess, translation) {
    if (!guess) return false;
    const senses = (translation || '')
        .split(/[\/,;|]/)
        .flatMap((sense) => [sense, sense.replace(/\([^)]*\)/g, '')])
        .map(normalise)
        .filter(Boolean);

    return senses.some((sense) =>
        sense === guess ||
        (guess.length >= 4 && sense.startsWith(guess) && guess.length / sense.length >= 0.7));
}

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
        applyPlanToUI();
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

    const cap = s.new_per_day ?? 20;
    const newToday = s.new_today ?? 0;
    const newLeft = Math.max(0, cap - newToday);
    $('goalText').textContent =
        `วันนี้ ${done} / ${goal} คำ${done >= goal ? ' 🎉' : ''} · คำใหม่เหลือ ${newLeft}/${cap}`;
}

function renderStats() {
    const s = state.stats;
    if (!s) return;
    $('sLearning').textContent = s.learning ?? 0;
    $('sReview').textContent = s.in_review ?? 0;
    $('sMastered').textContent = s.mastered ?? 0;
    $('sSuspended').textContent = s.suspended ?? 0;
    $('sStreak').textContent = s.streak ?? '🔒';
    $('sToday').textContent = s.today ?? 0;

    $('dailyGoalInput').value = s.daily_goal ?? 20;
    $('newPerDayInput').value = s.new_per_day_wanted ?? s.new_per_day ?? 20;

    renderLevelBars(s.by_level || {});
    if (s.heatmap) renderHeatmap(s.heatmap);
    if (s.forecast) renderForecast(s.forecast);
}

const LEVEL_TOTALS = { A1: 751, A2: 751, B1: 767, B2: 727 };

function renderLevelBars(byLevel) {
    const box = $('levelBars');
    const levels = allowedLevels();
    box.innerHTML = '';
    Object.entries(LEVEL_TOTALS).forEach(([level, total]) => {
        const locked = Boolean(levels) && !levels.includes(level);
        const done = byLevel[level] || 0;
        const pct = done ? Math.max(1.5, Math.min(100, (done / total) * 100)) : 0;
        const row = document.createElement('div');
        row.className = 'level-bar' + (locked ? ' is-locked' : '');
        row.innerHTML = `
            <span class="level-bar-name">${level}${locked ? ' 🔒' : ''}</span>
            <span class="level-bar-track"><span class="level-bar-fill" style="width:${pct.toFixed(2)}%"></span></span>
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
    start.setDate(start.getDate() - start.getDay());   // align to Sunday

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
                const key = isoDate(d);
                const n = map[key] || 0;
                cell.className = 'hm-' + (n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 35 ? 3 : 4);
                cell.title = `${key} · ${n} คำ`;
            }
            col.appendChild(cell);
        }
        frag.appendChild(col);
    }
    box.appendChild(frag);
    box.scrollLeft = box.scrollWidth;   // a year is wider than the panel
}

/** Cards already scheduled for each of the next seven days. */
function renderForecast(forecast) {
    const box = $('forecastBars');
    box.innerHTML = '';

    const days = [];
    for (let offset = 0; offset < 7; offset++) {
        const day = new Date();
        day.setDate(day.getDate() + offset);
        const key = isoDate(day);
        const count = offset === 0
            ? Object.entries(forecast).reduce((sum, [d, n]) => (d <= key ? sum + n : sum), 0)
            : (forecast[key] || 0);
        days.push({ key, offset, count });
    }

    const peak = Math.max(1, ...days.map((d) => d.count));
    const labels = ['วันนี้', 'พรุ่งนี้', 'อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

    days.forEach(({ offset, count, key }) => {
        const date = new Date(key + 'T00:00:00');
        const label = offset < 2 ? labels[offset] : labels[2 + date.getDay()];
        const bar = document.createElement('div');
        bar.className = 'forecast-day';
        bar.innerHTML = `
            <span class="forecast-count">${count}</span>
            <span class="forecast-bar" style="height:${Math.round((count / peak) * 100)}%"></span>
            <span class="forecast-label">${label}</span>`;
        bar.title = `${key} · ${count} คำ`;
        box.appendChild(bar);
    });
}

async function renderBadges() {
    const box = $('badgeGrid');
    let badges = [];
    try { badges = await api.getBadges(); }
    catch { box.innerHTML = '<p class="empty-message">โหลดเหรียญตราไม่สำเร็จ</p>'; return; }

    box.innerHTML = '';
    badges.forEach((b) => {
        const el = document.createElement('div');
        el.className = 'badge' + (b.earned ? ' is-earned' : '');
        el.title = `${b.detail} · ${b.value}/${b.threshold}`;
        el.innerHTML = `
            <span class="badge-icon">${b.icon}</span>
            <span class="badge-name">${escapeHtml(b.name)}</span>
            <span class="badge-progress"><span style="width:${Math.round(b.progress * 100)}%"></span></span>
            <span class="badge-value">${b.value}/${b.threshold}</span>`;
        box.appendChild(el);
    });
}

async function saveGoal() {
    const goal = Number($('dailyGoalInput').value);
    const newPerDay = Number($('newPerDayInput').value);
    if (!goal || goal < 1 || goal > 500) return toast('เป้าหมายต้องอยู่ระหว่าง 1–500');
    if (!Number.isFinite(newPerDay) || newPerDay < 0 || newPerDay > 200) {
        return toast('คำใหม่ต่อวันต้องอยู่ระหว่าง 0–200');
    }
    try {
        await api.saveSettings({ dailyGoal: goal, newPerDay });
        await refreshStats();
        toast(isPro() || newPerDay <= 10
            ? 'บันทึกแล้ว'
            : 'บันทึกแล้ว — บัญชีฟรียังจำกัดที่ 10 คำใหม่ต่อวัน');
    } catch (err) {
        toast('บันทึกไม่สำเร็จ: ' + err.message);
    }
}

async function changePassword() {
    const current = $('currentPassword').value;
    const next = $('newPassword').value;
    const hint = $('passwordHint');

    if (!current || !next) { hint.textContent = 'กรอกทั้งรหัสเดิมและรหัสใหม่'; return; }
    if (next.length < 8) { hint.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร'; return; }

    const btn = $('changePasswordBtn');
    btn.disabled = true;
    hint.textContent = 'กำลังเปลี่ยน...';
    try {
        await api.changePassword(current, next);
        $('currentPassword').value = '';
        $('newPassword').value = '';
        hint.textContent = '✅ เปลี่ยนรหัสผ่านแล้ว ครั้งหน้าใช้รหัสใหม่';
        toast('เปลี่ยนรหัสผ่านแล้ว');
    } catch (err) {
        hint.textContent = '❌ ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

async function saveUsername() {
    const name = $('usernameInput').value.trim().toLowerCase();
    try {
        await api.setUsername(name);
        state.account.username = name;
        applyAccount();
        toast('เปลี่ยนชื่อผู้ใช้แล้ว');
    } catch (err) {
        $('accountHint').textContent = '❌ ' + err.message;
    }
}

async function saveEmail() {
    const email = $('emailInput').value.trim();
    if (!/\S+@\S+\.\S+/.test(email)) {
        $('accountHint').textContent = 'กรอกอีเมลให้ถูกต้อง';
        return;
    }
    try {
        await api.changeEmail(email);
        $('accountHint').textContent =
            '📧 ส่งลิงก์ยืนยันไปที่อีเมลนั้นแล้ว — กดยืนยันเพื่อให้มีผล';
    } catch (err) {
        $('accountHint').textContent = '❌ ' + err.message;
    }
}

// ===================== LEADERBOARD =====================
async function renderLeaderboard() {
    const box = $('rankBody');
    box.innerHTML = '<p class="loading">กำลังโหลด...</p>';

    let board;
    try {
        board = await api.getLeaderboard(state.rankMetric, 20);
    } catch (err) {
        box.innerHTML = `
            <div class="pro-lock is-block">
                <p>🔒 ${escapeHtml(err.message)}</p>
                <button class="btn btn-pro" data-goto-pro>✨ ดูแพ็กเกจ</button>
            </div>`;
        box.querySelector('[data-goto-pro]')?.addEventListener('click', () => switchView('pro'));
        return;
    }

    const unit = { week: 'ครั้ง', streak: 'วัน', mastered: 'คำ' }[board.metric] || '';
    if (!board.top.length) {
        box.innerHTML = '<p class="empty-message">ยังไม่มีใครขึ้นกระดาน เริ่มทบทวนวันนี้ได้เลย</p>';
        return;
    }

    const rows = board.top.map((r) => `
        <div class="rank-row${r.is_me ? ' is-me' : ''}">
            <span class="rank-pos rank-${r.rank <= 3 ? r.rank : 'n'}">${r.rank}</span>
            <span class="rank-name">${escapeHtml(r.username)}${r.is_me ? ' (คุณ)' : ''}</span>
            <span class="rank-value">${r.value} ${unit}</span>
        </div>`).join('');

    const mine = board.me && !board.top.some((r) => r.is_me)
        ? `<div class="rank-row is-me is-detached">
             <span class="rank-pos rank-n">${board.me.rank}</span>
             <span class="rank-name">คุณ</span>
             <span class="rank-value">${board.me.value} ${unit}</span>
           </div>` : '';

    const hidden = board.listed === false
        ? '<p class="field-hint">คุณซ่อนชื่อจากกระดานอยู่ — เปิดได้ที่แท็บสถิติ</p>' : '';

    box.innerHTML = `<div class="rank-table">${rows}${mine}</div>${hidden}`;
}

// ===================== PRO / BILLING =====================
async function renderPro() {
    const status = $('proStatus');
    const a = state.account;
    status.textContent = a?.is_pro
        ? `✅ คุณเป็นสมาชิก Pro ถึง ${formatDate(a.pro_until)}`
        : 'ตอนนี้ใช้แพ็กเกจฟรีอยู่';

    if (!state.billing) {
        try { state.billing = await api.getBillingConfig(); }
        catch { $('planGrid').innerHTML = '<p class="empty-message">โหลดแพ็กเกจไม่สำเร็จ</p>'; return; }
    }

    const cfg = state.billing;
    if (!cfg.omise_public_key && !cfg.promptpay_live) {
        $('planGrid').innerHTML = `<p class="empty-message">
            ยังไม่เปิดรับชำระเงิน</p>`;
        show($('payPanel'), false);
    } else {
        $('planGrid').innerHTML = cfg.plans.map((p) => `
            <button class="plan-card${state.selectedPlan === p.code ? ' is-selected' : ''}"
                    data-code="${p.code}"
                    data-note="${escapeHtml(p.label_th)} — ${baht(p.amount_satang)} บาท">
                ${p.badge_th ? `<span class="plan-badge">${escapeHtml(p.badge_th)}</span>` : ''}
                <span class="plan-name">${escapeHtml(p.label_th)}</span>
                <span class="plan-price">฿${baht(p.amount_satang)}</span>
                <span class="plan-per">≈ ฿${baht(Math.round(p.amount_satang / p.months))}/เดือน</span>
            </button>`).join('');
        if (!cfg.live) {
            $('planGrid').insertAdjacentHTML('afterend',
                '<p class="field-hint">⚠️ โหมดทดสอบ — ยังไม่ตัดเงินจริง</p>');
        }
    }

    renderBillingHistory();
    renderAdminQueue();
}

/**
 * The owner's slip queue. Everyone else gets "not allowed" from the RPC, so
 * there is nothing to hide client side — the panel simply stays empty.
 */
async function renderAdminQueue() {
    let rows;
    try { rows = await api.pendingPayments(); }
    catch { return show($('adminPanel'), false); }

    show($('adminPanel'), true);
    const box = $('adminQueue');
    if (!rows.length) {
        box.innerHTML = '<p class="empty-message">ไม่มีสลิปรอตรวจ</p>';
        return;
    }

    box.innerHTML = rows.map((r) => `
        <div class="word-row" data-intent="${r.id}">
            <div class="word-row-main">
                <strong>฿${baht(r.amount_satang)} · ${r.months} เดือน</strong>
                <span class="translation-small">${escapeHtml(r.username || r.email)} · ${formatDate(r.created_at)}</span>
            </div>
            <div class="word-row-meta">
                <button class="btn btn-secondary" data-slip="${escapeHtml(r.slip_path)}">ดูสลิป</button>
                <button class="btn btn-pro" data-approve="${r.id}">อนุมัติ</button>
                <button class="btn btn-secondary" data-reject="${r.id}">ปฏิเสธ</button>
            </div>
        </div>`).join('');

    box.onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        try {
            if (btn.dataset.slip) {
                window.open(await api.slipUrl(btn.dataset.slip), '_blank', 'noopener');
            } else if (btn.dataset.approve) {
                await api.approvePayment(btn.dataset.approve, 'ตรวจด้วยตาแล้ว');
                toast('อนุมัติแล้ว');
                renderAdminQueue();
            } else if (btn.dataset.reject) {
                await api.rejectPayment(btn.dataset.reject, 'ยอดไม่ตรง/ไม่พบเงินเข้า');
                toast('ปฏิเสธแล้ว');
                renderAdminQueue();
            }
        } catch (err) {
            toast(err.message);
        }
    };
}

async function renderBillingHistory() {
    const box = $('billingHistory');
    let rows = [];
    try { rows = await api.getBillingHistory(); } catch { /* keep it quiet */ }

    if (!rows.length) {
        box.innerHTML = '<p class="empty-message">ยังไม่มีรายการ</p>';
        return;
    }
    box.innerHTML = rows.map((r) => `
        <div class="word-row">
            <div class="word-row-main">
                <strong>฿${baht(r.amount_satang)} · ${r.months} เดือน</strong>
                <span class="translation-small">${formatDate(r.created_at)} · ${escapeHtml(r.method || '')}</span>
            </div>
            <div class="word-row-meta">
                <span class="status-badge status-mastered">สำเร็จ</span>
            </div>
        </div>`).join('');
}

async function pay() {
    const err = $('payError');
    show(err, false);

    if (!state.selectedPlan) return toast('เลือกแพ็กเกจก่อน');
    const btn = $('payBtn');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังดำเนินการ...';

    try {
        // PromptPay straight to the owner's account: no gateway, so the QR is
        // drawn here and the payer proves it with a slip afterwards.
        if (state.payMethod === 'promptpay' && state.billing.promptpay_live) {
            await startDirectPromptPay();
            return;
        }

        let token;
        if (state.payMethod === 'card') {
            const omise = await api.loadOmise(state.billing.omise_public_key);
            token = await api.tokenizeCard(omise, {
                name: $('cardName').value.trim(),
                number: $('cardNumber').value.replace(/\s/g, ''),
                expiration_month: Number($('cardMonth').value),
                expiration_year: Number($('cardYear').value),
                security_code: $('cardCvc').value.trim()
            });
        }

        const charge = await api.createCharge({
            plan: state.selectedPlan, method: state.payMethod, token
        });

        if (charge.authorize_uri) {
            // 3-D Secure: the bank takes over from here
            window.location.href = charge.authorize_uri;
            return;
        }

        if (charge.qr_image) {
            $('qrImage').src = charge.qr_image;
            show($('qrBox'), true);
            $('qrStatus').textContent = 'กำลังรอการชำระเงิน…';
        }

        $('qrStatus').textContent = 'กำลังรอการชำระเงิน…';
        const account = await api.waitForPro();
        if (account) {
            state.account = account;
            applyAccount();
            await refreshStats();
            show($('qrBox'), false);
            toast('🎉 เป็นสมาชิก Pro แล้ว');
            renderPro();
        } else {
            $('qrStatus').textContent = 'ยังไม่ได้รับการชำระเงิน — ถ้าจ่ายแล้วให้รอสักครู่หรือรีเฟรช';
        }
    } catch (e) {
        err.textContent = e.message;
        show(err, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'ดำเนินการชำระเงิน';
    }
}

/**
 * Draw the PromptPay QR for the plan that is selected and wait for a slip.
 * The amount is whatever the server put on the intent, not what the page
 * thinks the plan costs.
 */
async function startDirectPromptPay() {
    const intent = await api.startPromptPay(state.selectedPlan);
    state.intent = intent;

    const { promptPayPayload, drawQR } = await import('./promptpay.js?v=dev');
    const baht = intent.amount_satang / 100;

    show($('qrImage'), false);
    show($('qrCanvas'), true);
    await drawQR($('qrCanvas'), promptPayPayload(intent.promptpay_id, baht));

    $('qrAmount').textContent = `${intent.label_th} · ฿${baht.toFixed(2)}`;
    $('qrStatus').textContent = 'สแกนแล้วโอนตามยอดนี้ให้ตรงเป๊ะ';
    show($('slipUpload'), true);
    show($('qrBox'), true);
}

/** Send the slip to be checked, and report exactly why if it is refused. */
async function submitSlip() {
    const file = $('slipFile').files?.[0];
    const err = $('payError');
    show(err, false);

    if (!state.intent) return toast('เริ่มรายการชำระเงินก่อน');
    if (!file) return toast('เลือกรูปสลิปก่อน');

    const btn = $('slipBtn');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังตรวจสลิป...';
    try {
        const result = await api.verifySlip({ intentId: state.intent.intent_id, file });

        if (result.status === 'paid') {
            state.account = await api.getAccount();
            applyAccount();
            await refreshStats();
            show($('qrBox'), false);
            toast('🎉 เป็นสมาชิก Pro แล้ว');
            renderPro();
            return;
        }
        // Verifier could not answer. The claim is kept, not thrown away.
        $('qrStatus').textContent = result.message
            || 'ส่งสลิปแล้ว รอตรวจสอบ';
    } catch (e) {
        err.textContent = e.message;
        show(err, true);
    } finally {
        btn.disabled = false;
        btn.textContent = 'ตรวจสลิปและเปิด Pro';
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
        box.innerHTML = `<p class="empty-message">ค้นหาไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
        return;
    }

    if (!rows.length) {
        box.innerHTML = '<p class="empty-message">ไม่พบคำที่ตรงกับการค้นหา</p>';
        return;
    }

    const allowed = allowedLevels();
    box.innerHTML = rows.map((row) => {
        const locked = Boolean(allowed) && row.level && !allowed.includes(row.level);
        return `
        <div class="word-row${locked ? ' is-locked' : ''}">
            <div class="word-row-main">
                <strong>${escapeHtml(row.word)}</strong>
                <span class="translation-small">${escapeHtml(row.translation || '—')}</span>
                ${row.example_en ? `<span class="translation-small example-en">${escapeHtml(row.example_en)}</span>` : ''}
            </div>
            <div class="word-row-meta">
                ${row.level ? `<span class="level-tag">${row.level}</span>` : ''}
                <span class="status-badge status-${row.status}">${STATUS_TH[row.status] || row.status}</span>
                ${locked ? '<span class="status-badge">🔒 Pro</span>' : ''}
            </div>
        </div>`;
    }).join('');
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
        box.innerHTML = `<p class="empty-message">โหลดไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
        return;
    }

    if (!words.length) {
        box.innerHTML = '<p class="empty-message">ไม่มีคำในรายการนี้</p>';
        return;
    }

    box.innerHTML = `
        <div class="learned-count-badge">
            <span class="count-icon">🎯</span>
            <span class="count-text">จำได้แล้ว</span>
            <span class="count-number">${words.length}</span>
        </div>
        <div class="hidden-words-list">
            ${words.map((w) => `
                <div class="hidden-word-item" data-word-id="${w.id}">
                    <div class="word-info">
                        <strong>${escapeHtml(w.word)}</strong>
                        <span class="translation-small">${escapeHtml(w.translation || '—')}</span>
                    </div>
                    <button class="btn btn-unhide" data-word-id="${w.id}">ยกเลิกการจำ</button>
                </div>`).join('')}
        </div>`;
}

async function unsuspend(wordId) {
    try {
        await api.setSuspended(wordId, false);
        $('hiddenWordsList').querySelector(`.hidden-word-item[data-word-id="${wordId}"]`)?.remove();
        if (state.stats && state.stats.suspended > 0) state.stats.suspended--;
        renderStudyStats();

        const left = $('hiddenWordsList').querySelectorAll('.hidden-word-item').length;
        const badge = document.querySelector('.learned-count-badge .count-number');
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
    el.textContent = ok ? 'เชื่อมต่อแล้ว' : `ออฟไลน์${pending ? ` · ค้างส่ง ${pending}` : ''}`;
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

const isoDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const baht = (satang) => (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 0 });

const formatDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
    : '-';

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
