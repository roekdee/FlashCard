/**
 * Oxford 3000 Flashcards — data layer.
 *
 * Talks to Supabase Postgres. Every screen is one round trip: the SM-2
 * scheduling, the queue building, the plan limits and the stats all run in SQL
 * (see supabase/migrations/), so the client just calls one function and renders.
 *
 * The key below is the *publishable* key. It is meant to ship in the browser —
 * row level security is what actually protects the data, so a user can only
 * ever read or write their own rows, and the Free/Pro limits are enforced by
 * the database rather than by hiding buttons.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const CONFIG = {
    SUPABASE_URL: 'https://xixvrekqkikxrzrinjko.supabase.co',
    SUPABASE_KEY: 'sb_publishable__KxoQUALn5pWF3qM0I12QQ_19cGBEXw',
    QUEUE_SIZE: 40
};

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,   // Google sign-in and the reset link come back via the URL
        storageKey: 'flash_auth'
    }
});

/** Unwrap a PostgREST result, throwing the message the user should actually see. */
function unwrap({ data, error }) {
    if (error) throw new Error(translateError(error));
    return data;
}

function translateError(error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (msg.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล — เช็คกล่องจดหมายก่อน';
    if (msg.includes('already registered') || msg.includes('already been registered')) {
        return 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน';
    }
    if (msg.includes('password should be')) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    if (msg.includes('for security purposes') || msg.includes('rate limit')) {
        return 'ทำรายการถี่เกินไป รออีกสักครู่แล้วลองใหม่';
    }
    if (msg.includes('provider is not enabled') || msg.includes('unsupported provider')) {
        return 'ยังไม่ได้เปิดใช้งาน Google login — เข้าสู่ระบบด้วยอีเมลไปก่อน';
    }
    if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    return error.message || 'เกิดข้อผิดพลาด';
}

const looksLikeEmail = (value) => /\S+@\S+\.\S+/.test(value);

// ===================== AUTH =====================

/**
 * Sign in with an email address, or with a username for the accounts carried
 * over from the spreadsheet.
 *
 * The username path resolves through `legacy_login_email`, which only answers
 * while the account still has its synthetic @oxford3000.local address — so it
 * cannot be used to discover anybody's real email.
 */
export async function signIn(identifier, password) {
    let email = identifier.trim();

    if (!looksLikeEmail(email)) {
        const legacy = unwrap(await supabase.rpc('legacy_login_email', { p_username: email }));
        if (!legacy) {
            throw new Error('ไม่พบบัญชีนี้ — ลองเข้าสู่ระบบด้วยอีเมล');
        }
        email = legacy;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateError(error));
    return data.user;
}

/** Create an account from a real email address. */
export async function signUp({ email, password, username }) {
    const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
            data: { username: (username || '').trim().toLowerCase() },
            emailRedirectTo: window.location.origin
        }
    });
    if (error) throw new Error(translateError(error));
    // No session means the project requires a confirmation click first.
    return { user: data.user, needsConfirmation: !data.session };
}

export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
    });
    if (error) throw new Error(translateError(error));
}

export async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + '#reset'
    });
    if (error) throw new Error(translateError(error));
}

/** Used on the recovery screen, where Supabase has already put us in a session. */
export async function setNewPassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(translateError(error));
}

/** Attach a real address to a legacy username account, or change an existing one. */
export async function changeEmail(email) {
    const { error } = await supabase.auth.updateUser(
        { email: email.trim() },
        { emailRedirectTo: window.location.origin }
    );
    if (error) throw new Error(translateError(error));
}

export const signOut = () => supabase.auth.signOut();

export async function usernameAvailable(username) {
    return unwrap(await supabase.rpc('username_available', { p_username: username }));
}

export async function setUsername(username) {
    return unwrap(await supabase.rpc('set_username', { p_username: username }));
}

/** Username, email, plan and preferences in one call. */
export async function getAccount() {
    return unwrap(await supabase.rpc('my_account'));
}

export async function saveSettings({ dailyGoal, newPerDay, showOnLeaderboard }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const patch = {};
    if (Number.isFinite(dailyGoal)) patch.daily_goal = dailyGoal;
    if (Number.isFinite(newPerDay)) patch.new_per_day = newPerDay;
    if (typeof showOnLeaderboard === 'boolean') patch.show_on_leaderboard = showOnLeaderboard;
    if (!Object.keys(patch).length) return;
    return unwrap(await supabase.from('profiles').update(patch).eq('id', user.id));
}

export async function changePassword(currentPassword, newPassword) {
    return unwrap(await supabase.rpc('change_password', {
        p_current: currentPassword, p_new: newPassword
    }));
}

// ===================== STUDY =====================

export async function getQueue({ levels = null, pos = null, limit = CONFIG.QUEUE_SIZE } = {}) {
    return unwrap(await supabase.rpc('get_study_queue', {
        p_limit: limit,
        p_levels: levels && levels.length ? levels : null,
        p_pos: pos && pos.length ? pos : null
    })) || [];
}

export async function reviewCard(wordId, grade, mode = 'flip') {
    return unwrap(await supabase.rpc('review_card', {
        p_word_id: wordId, p_grade: grade, p_mode: mode
    }));
}

/** Roll back the most recent answer — a misclick used to be permanent. */
export async function undoLastReview() {
    return unwrap(await supabase.rpc('undo_last_review'));
}

export async function setSuspended(wordId, suspended) {
    return unwrap(await supabase.rpc('set_card_suspended', {
        p_word_id: wordId, p_suspended: suspended
    }));
}

export async function getStats() {
    return unwrap(await supabase.rpc('get_stats'));
}

export async function getSuspendedWords(search = '') {
    return unwrap(await supabase.rpc('get_suspended_words', { p_search: search || null })) || [];
}

export async function getQuizOptions(wordId) {
    return unwrap(await supabase.rpc('get_quiz_options', { p_word_id: wordId })) || [];
}

export async function searchWords(query, levels = null, limit = 60, offset = 0) {
    return unwrap(await supabase.rpc('search_words', {
        p_query: query || null,
        p_levels: levels && levels.length ? levels : null,
        p_limit: limit,
        p_offset: offset
    })) || [];
}

export async function getPosList() {
    return unwrap(await supabase.rpc('get_pos_list')) || [];
}

// ===================== LEADERBOARD & BADGES =====================

export async function getLeaderboard(metric = 'week', limit = 20) {
    return unwrap(await supabase.rpc('get_leaderboard', { p_metric: metric, p_limit: limit }));
}

export async function getBadges() {
    return unwrap(await supabase.rpc('get_my_badges')) || [];
}

// ===================== BILLING =====================

export async function getBillingConfig() {
    return unwrap(await supabase.rpc('get_billing_config'));
}

export async function getBillingHistory() {
    return unwrap(await supabase
        .from('billing_events')
        .select('charge_id, amount_satang, currency, months, method, created_at, pro_until_after')
        .order('created_at', { ascending: false })
        .limit(20)) || [];
}

/**
 * Ask the server to open an Omise charge. The amount is looked up from
 * billing_plans inside the function, so nothing here can choose a price.
 */
export async function createCharge({ plan, method, token }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน');

    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/create-charge`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: CONFIG.SUPABASE_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ plan, method, token, return_uri: window.location.origin + '#billing' })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body.error || 'เริ่มรายการชำระเงินไม่สำเร็จ');
    return body;
}

/** Omise.js, loaded only when somebody actually reaches for a card. */
let omiseReady = null;
export function loadOmise(publicKey) {
    if (omiseReady) return omiseReady;
    omiseReady = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.omise.co/omise.js';
        script.onload = () => {
            if (!window.Omise) return reject(new Error('โหลด Omise ไม่สำเร็จ'));
            window.Omise.setPublicKey(publicKey);
            resolve(window.Omise);
        };
        script.onerror = () => reject(new Error('โหลด Omise ไม่สำเร็จ'));
        document.head.appendChild(script);
    });
    return omiseReady;
}

/** Card details go straight from the browser to Omise; they never reach us. */
export function tokenizeCard(omise, card) {
    return new Promise((resolve, reject) => {
        omise.createToken('card', card, (status, response) => {
            if (status === 200) resolve(response.id);
            else reject(new Error(response.message || 'บัตรไม่ถูกต้อง'));
        });
    });
}

/** Poll until the webhook has granted the time we just paid for. */
export async function waitForPro({ timeoutMs = 300000, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const account = await getAccount().catch(() => null);
        if (account?.is_pro) return account;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

// ===================== OFFLINE OUTBOX =====================

const OUTBOX_KEY = 'flash_outbox';

// Every item carries the user it belongs to. Two people sharing a browser must
// not inherit each other's parked reviews when the first one signs back in.
let cachedUserId = null;

supabase.auth.getSession().then(({ data }) => { cachedUserId = data.session?.user?.id ?? null; });
supabase.auth.onAuthStateChange((_event, session) => { cachedUserId = session?.user?.id ?? null; });

const readOutbox = () => {
    try {
        const items = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
        return Array.isArray(items) ? items : [];
    } catch { return []; }
};

const writeOutbox = (items) => {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-500))); }
    catch { /* storage full or blocked — the review is lost, not the session */ }
};

const mine = (item) => item.uid === cachedUserId;

export const outboxSize = () => readOutbox().filter(mine).length;

export function queueReview(wordId, grade, mode) {
    if (!cachedUserId) return;   // nothing to attribute it to
    const items = readOutbox();
    items.push({ uid: cachedUserId, wordId, grade, mode, at: Date.now() });
    writeOutbox(items);
}

/**
 * Replay this user's parked reviews, oldest first. Stops at the first failure
 * and keeps everything that has not gone through, including other users' items.
 */
export async function flushOutbox() {
    const items = readOutbox();
    if (!items.some(mine)) return 0;

    let remaining = items;
    let sent = 0;

    for (const item of items.filter(mine)) {
        try {
            await reviewCard(item.wordId, item.grade, item.mode);
        } catch {
            break;
        }
        remaining = remaining.filter((other) => other !== item);
        writeOutbox(remaining);
        sent++;
    }
    return sent;
}

/** Review that survives a dropped connection. */
export async function reviewCardResilient(wordId, grade, mode) {
    try {
        return await reviewCard(wordId, grade, mode);
    } catch (err) {
        // A plan refusal is a real answer, not a network blip — do not park it.
        if (/Pro/i.test(err.message)) throw err;
        queueReview(wordId, grade, mode);
        throw err;
    }
}
