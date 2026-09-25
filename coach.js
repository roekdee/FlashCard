/**
 * AI English coach: two sub-tabs backed by the ai-coach edge function.
 *   1. แต่งประโยค  — write a sentence with a given word, Gemini grades it.
 *   2. ฝึกสนทนา    — role-play a scenario chat with the coach.
 *
 * Renders only inside #coachRoot. The quota (N/limit calls today) comes back
 * on every successful call and is also fetched once on entry.
 */
import * as api from './api.js?v=dev';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SCENARIOS = [
    { id: 'restaurant', emoji: '🍽️', title: 'ร้านอาหาร', opener: "Hi there! Welcome in. How many people, and do you have a table in mind?" },
    { id: 'job_interview', emoji: '💼', title: 'สัมภาษณ์งาน', opener: "Thanks for coming in today. So, tell me a little about yourself." },
    { id: 'hotel', emoji: '🏨', title: 'เข้าพักโรงแรม', opener: "Good evening, welcome to the hotel! Do you have a reservation with us?" },
    { id: 'directions', emoji: '🧭', title: 'ถามทาง', opener: "Oh, hi! You look a bit lost — is there somewhere I can help you find?" },
    { id: 'shopping', emoji: '🛍️', title: 'ซื้อของ', opener: "Hello! Let me know if you need any help finding something today." },
    { id: 'doctor', emoji: '🩺', title: 'พบแพทย์', opener: "Good morning, please have a seat. So, what brings you in today?" },
    { id: 'small_talk', emoji: '💬', title: 'พูดคุยทั่วไป', opener: "Hey, long time no see! How have you been lately?" },
    { id: 'meeting', emoji: '📊', title: 'ประชุมงาน', opener: "Alright, thanks for joining — shall we start with your update?" },
];

let deps = null;
let quota = { limit: 0, used: 0 };
let sub = 'write';                     // 'write' | 'chat'

// ---- แต่งประโยค state ----
let queueWords = [];
let currentWord = null;
let lastResult = null;
let checking = false;

// ---- ฝึกสนทนา state ----
let chatScenario = null;
let chatLevel = 'B1';
let chatHistory = [];                  // [{ role: 'user'|'coach', text }]
let chatBusy = false;
let recognition = null;

function root() { return $('coachRoot'); }

export function initCoach(d) {
    deps = d;
}

export async function showCoach() {
    chatLevel = deps.placementLevel() || 'B1';
    refreshQuota();
    if (!queueWords.length) loadQueueWords();
    render();
}

async function refreshQuota() {
    try { quota = await api.getAiQuota(); } catch { /* header just stays blank */ }
    renderHeader();
}

async function loadQueueWords() {
    try { queueWords = await api.getQueue({ limit: 20 }); } catch { queueWords = []; }
    if (sub === 'write' && !checking) renderWrite();
}

function render() {
    root().innerHTML = `
        <div class="coach-header" id="coachHeader"></div>
        <div class="coach-subtabs">
            <button class="btn ${sub === 'write' ? 'btn-primary' : 'btn-secondary'}" data-sub="write">✍️ แต่งประโยค</button>
            <button class="btn ${sub === 'chat' ? 'btn-primary' : 'btn-secondary'}" data-sub="chat">💬 ฝึกสนทนา</button>
        </div>
        <div id="coachBody"></div>`;
    renderHeader();

    root().querySelector('.coach-subtabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sub]');
        if (!btn) return;
        sub = btn.dataset.sub;
        render();
    });

    if (sub === 'write') renderWrite(); else renderChat();
}

function renderHeader() {
    const el = $('coachHeader');
    if (!el) return;
    el.innerHTML = `<p class="coach-quota">เหลือ <strong>${quota.used >= quota.limit ? 0 : quota.limit - quota.used}</strong>/${quota.limit} ครั้งวันนี้</p>`;
}

// ===================== แต่งประโยค =====================

function pickWord(word) {
    currentWord = word;
    lastResult = null;
    renderWrite();
}

function renderWrite() {
    const body = $('coachBody');
    if (!body) return;
    const chips = queueWords.slice(0, 12);

    body.innerHTML = `
        <div class="panel">
            <h3 class="panel-title">เลือกคำ</h3>
            <div class="chips" id="coachWordChips">
                ${chips.map((w) => `<button class="chip${currentWord?.word === w.word ? ' is-active' : ''}" data-word="${esc(w.word)}">${esc(w.word)}</button>`).join('')
                    || '<p class="field-hint">กำลังโหลดคำ...</p>'}
            </div>
            <input class="select-input coach-word-input" id="coachWordInput" type="text" maxlength="60"
                placeholder="หรือพิมพ์คำเอง..." value="${currentWord ? esc(currentWord.word) : ''}">
        </div>
        <div class="panel">
            <h3 class="panel-title">แต่งประโยคโดยใช้คำนี้</h3>
            <textarea class="select-input coach-sentence" id="coachSentence" rows="3" maxlength="300"
                placeholder="Write an English sentence using the word above..."></textarea>
            <div class="secondary-row">
                <button class="btn btn-primary" id="coachCheckBtn">ให้ AI ตรวจ</button>
                <button class="btn btn-secondary" id="coachNextWordBtn">คำถัดไป</button>
            </div>
            <p class="loading" id="coachWriteLoading" hidden>กำลังตรวจ...</p>
        </div>
        <div id="coachResult"></div>`;

    body.querySelector('#coachWordChips').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-word]');
        if (chip) pickWord({ word: chip.dataset.word });
    });
    body.querySelector('#coachWordInput').addEventListener('change', (e) => {
        const word = e.target.value.trim();
        if (word) pickWord({ word });
    });
    body.querySelector('#coachCheckBtn').addEventListener('click', runCheck);
    body.querySelector('#coachNextWordBtn').addEventListener('click', nextWord);

    renderResult();
    setWriteBusy(checking);
}

function nextWord() {
    if (!queueWords.length) return;
    const i = queueWords.findIndex((w) => w.word === currentWord?.word);
    currentWord = queueWords[(i + 1) % queueWords.length];
    lastResult = null;
    renderWrite();
}

function setWriteBusy(busy) {
    const checkBtn = $('coachCheckBtn');
    const loading = $('coachWriteLoading');
    if (checkBtn) checkBtn.disabled = busy;
    if (loading) loading.hidden = !busy;
}

async function runCheck() {
    const word = ($('coachWordInput')?.value || '').trim();
    const sentence = ($('coachSentence')?.value || '').trim();
    if (!word) return deps.toast('เลือกหรือพิมพ์คำก่อน');
    if (!sentence) return deps.toast('พิมพ์ประโยคก่อน');
    if (checking) return;

    checking = true;
    setWriteBusy(true);
    try {
        const res = await api.askCoach({ action: 'check', word, sentence });
        lastResult = res;
        quota.used = Math.max(0, quota.limit - res.remaining);
        renderHeader();
        renderResult();
    } catch (err) {
        deps.toast(err.message);
    } finally {
        checking = false;
        setWriteBusy(false);
    }
}

function renderResult() {
    const el = $('coachResult');
    if (!el) return;
    if (!lastResult) { el.innerHTML = ''; return; }
    const r = lastResult;
    el.innerHTML = `
        <div class="panel coach-result">
            <div class="coach-result-head">
                <span class="coach-score">${r.score}/10</span>
                <span class="${r.ok ? 'coach-ok' : 'coach-bad'}">${r.ok ? '✅ ถูกต้อง' : '❌ ยังไม่ถูก'}</span>
                ${r.uses_word ? '' : '<span class="coach-bad">⚠️ ไม่ได้ใช้คำนี้</span>'}
            </div>
            <p class="coach-field-label">ฉบับแก้ไข</p>
            <p class="coach-corrected">${esc(r.corrected)}</p>
            <p class="coach-feedback">${esc(r.feedback_th)}</p>
            ${r.tips_th?.length ? `<ul class="coach-tips">${r.tips_th.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
            <p class="coach-field-label">พูดได้เป็นธรรมชาติกว่านี้</p>
            <p class="coach-better">
                <button class="speak-btn" id="coachBetterSpeak" aria-label="ฟังประโยค">🔊</button>
                ${esc(r.better)}
            </p>
        </div>`;
    el.querySelector('#coachBetterSpeak')?.addEventListener('click', () => deps.speak(r.better));
}

// ===================== ฝึกสนทนา =====================

function renderChat() {
    const body = $('coachBody');
    if (!body) return;

    if (!chatScenario) {
        body.innerHTML = `
            <div class="panel">
                <h3 class="panel-title">เลือกสถานการณ์</h3>
                <div class="coach-scenario-grid">
                    ${SCENARIOS.map((s) => `
                        <button class="coach-scenario-card" data-scenario="${s.id}">
                            <span class="coach-scenario-emoji">${s.emoji}</span>
                            <span>${esc(s.title)}</span>
                        </button>`).join('')}
                </div>
                <label class="coach-level-label" for="coachLevelSelect">ระดับ</label>
                <select class="select-input" id="coachLevelSelect">
                    ${['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lv) =>
                        `<option value="${lv}"${lv === chatLevel ? ' selected' : ''}>${lv}</option>`).join('')}
                </select>
            </div>`;
        body.querySelector('#coachLevelSelect').addEventListener('change', (e) => { chatLevel = e.target.value; });
        body.querySelector('.coach-scenario-grid').addEventListener('click', (e) => {
            const card = e.target.closest('[data-scenario]');
            if (card) startScenario(card.dataset.scenario);
        });
        return;
    }

    const scenario = SCENARIOS.find((s) => s.id === chatScenario);
    body.innerHTML = `
        <div class="panel coach-chat-panel">
            <div class="coach-chat-head">
                <span>${scenario.emoji} ${esc(scenario.title)} · <span class="level-tag">${esc(chatLevel)}</span></span>
                <button class="btn btn-secondary" id="coachRestartBtn">เริ่มใหม่</button>
            </div>
            <div class="coach-chat-log" id="coachChatLog"></div>
            <p class="loading" id="coachChatTyping" hidden>กำลังพิมพ์...</p>
            <div class="coach-chat-input-row">
                <button class="speak-btn coach-mic-btn" id="coachMicBtn" aria-label="พูดใส่ไมค์" hidden>🎤</button>
                <input class="select-input coach-chat-input" id="coachChatInput" type="text" maxlength="500" placeholder="พิมพ์คำตอบเป็นภาษาอังกฤษ...">
                <button class="btn btn-primary" id="coachSendBtn">ส่ง</button>
            </div>
        </div>`;

    renderChatLog();
    body.querySelector('#coachRestartBtn').addEventListener('click', () => { chatScenario = null; chatHistory = []; renderChat(); });
    body.querySelector('#coachSendBtn').addEventListener('click', sendChatMessage);
    const input = body.querySelector('#coachChatInput');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });
    setupMic(body.querySelector('#coachMicBtn'), input);
}

function startScenario(id) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) return;
    chatScenario = id;
    chatHistory = [{ role: 'coach', text: scenario.opener, correction_th: '', suggestion: '' }];
    renderChat();
    deps.speak(scenario.opener);
}

function renderChatLog() {
    const log = $('coachChatLog');
    if (!log) return;
    log.innerHTML = chatHistory.map((m) => {
        if (m.role === 'coach') {
            return `
                <div class="coach-bubble coach-bubble-coach">
                    <button class="speak-btn" data-say="${esc(m.text)}" aria-label="ฟังประโยค">🔊</button>
                    <span>${esc(m.text)}</span>
                </div>`;
        }
        const note = m.correction_th
            ? `<div class="coach-bubble-note">
                   <p>${esc(m.correction_th)}</p>
                   ${m.suggestion ? `<p class="coach-suggestion">💡 ${esc(m.suggestion)}</p>` : ''}
               </div>`
            : '';
        return `
            <div class="coach-bubble coach-bubble-user">
                <div class="coach-bubble-learner">${esc(m.text)}</div>
                ${note}
            </div>`;
    }).join('');
    log.querySelectorAll('[data-say]').forEach((btn) => btn.addEventListener('click', () => deps.speak(btn.dataset.say)));
    log.scrollTop = log.scrollHeight;
}

function setChatBusy(busy) {
    const sendBtn = $('coachSendBtn');
    const input = $('coachChatInput');
    const typing = $('coachChatTyping');
    if (sendBtn) sendBtn.disabled = busy;
    if (input) input.disabled = busy;
    if (typing) typing.hidden = !busy;
}

async function sendChatMessage() {
    const input = $('coachChatInput');
    const text = (input?.value || '').trim();
    if (!text || chatBusy) return;

    chatHistory.push({ role: 'user', text, correction_th: '', suggestion: '' });
    if (input) input.value = '';
    renderChatLog();

    chatBusy = true;
    setChatBusy(true);
    try {
        const messages = chatHistory.slice(-20).map((m) => ({ role: m.role, text: m.text }));
        const res = await api.askCoach({ action: 'chat', scenario: chatScenario, level: chatLevel, messages });
        const last = chatHistory[chatHistory.length - 1];
        last.correction_th = res.correction_th || '';
        last.suggestion = res.suggestion || '';
        chatHistory.push({ role: 'coach', text: res.reply, correction_th: '', suggestion: '' });
        quota.used = Math.max(0, quota.limit - res.remaining);
        renderHeader();
        renderChatLog();
        deps.speak(res.reply);
    } catch (err) {
        chatHistory.pop();
        if (input) input.value = text;
        deps.toast(err.message);
        renderChatLog();
    } finally {
        chatBusy = false;
        setChatBusy(false);
    }
}

function setupMic(btn, input) {
    if (!btn) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.addEventListener('click', () => {
        if (!recognition) {
            recognition = new Recognition();
            recognition.lang = 'en-US';
            recognition.interimResults = false;
        }
        recognition.onresult = (e) => { input.value = e.results[0][0].transcript; };
        recognition.onerror = () => deps.toast('ฟังไม่สำเร็จ ลองใหม่อีกครั้ง');
        try { recognition.start(); } catch { /* already listening */ }
    });
}
