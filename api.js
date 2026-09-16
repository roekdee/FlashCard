/**
 * Oxford 3000 Flashcards — data layer.
 *
 * Talks to Supabase Postgres. Every screen is one round trip: the SM-2
 * scheduling, the queue building and the stats all run in SQL (see
 * supabase/migrations/), so the client just calls one function and renders.
 *
 * The key below is the *publishable* key. It is meant to ship in the browser —
 * row level security is what actually protects the data, so a user can only
 * ever read or write their own rows.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const CONFIG = {
    SUPABASE_URL: 'https://xixvrekqkikxrzrinjko.supabase.co',
    SUPABASE_KEY: 'sb_publishable__KxoQUALn5pWF3qM0I12QQ_19cGBEXw',
    // Supabase Auth wants an email; the app logs in by username, so we map
    // username -> username@EMAIL_DOMAIN. Users never see this.
    EMAIL_DOMAIN: 'oxford3000.local',
    QUEUE_SIZE: 40
};

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'flash_auth' }
});

const emailFor = (username) => `${username.trim().toLowerCase()}@${CONFIG.EMAIL_DOMAIN}`;

/** Unwrap a PostgREST result, throwing the message the user should actually see. */
function unwrap({ data, error }) {
    if (error) throw new Error(translateError(error));
    return data;
}

function translateError(error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('invalid login credentials')) return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    if (msg.includes('already registered')) return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว';
    if (msg.includes('password should be')) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    return error.message || 'เกิดข้อผิดพลาด';
}

// ===================== AUTH =====================

export async function signIn(username, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: emailFor(username), password
    });
    if (error) throw new Error(translateError(error));
    return data.user;
}

/**
 * Sign-up goes through a database function rather than supabase.auth.signUp().
 *
 * The app identifies people by username, so accounts use a synthetic
 * <username>@oxford3000.local address — and GoTrue rejects that domain on
 * signup, then tries to send a confirmation mail that the free tier caps at
 * about two per hour. public.register_user creates the account directly and
 * validates the username and password itself; sign-in afterwards is ordinary
 * Supabase Auth.
 */
export async function signUp(username, password) {
    const { error } = await supabase.rpc('register_user', {
        p_username: username.trim().toLowerCase(),
        p_password: password
    });
    if (error) throw new Error(translateError(error));
    return signIn(username, password);
}

export const signOut = () => supabase.auth.signOut();

export async function getProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    return data || { id: user.id, username: user.email.split('@')[0], daily_goal: 20 };
}

export async function saveDailyGoal(goal) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    return unwrap(await supabase.from('profiles').update({ daily_goal: goal }).eq('id', user.id));
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

// ===================== OFFLINE OUTBOX =====================
// Reviews taken with no connection are parked here and replayed on reconnect,
// so a session on the train is not lost.

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
        queueReview(wordId, grade, mode);
        throw err;
    }
}
