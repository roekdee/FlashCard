/**
 * Oxford 3000 Flashcards - Frontend JavaScript
 */

// ===================== CONFIG =====================
const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbxNwerSDLj8cFX6HIIcnFYYvhPyohFL5eUnMoZ4jXvEIP1bF-ByZJw9IJT2pWbVh5HctQ/exec', // ⚠️ แก้ไขตรงนี้
    API_KEY: 'AKfycbxNwerSDLj8cFX6HIIcnFYYvhPyohFL5eUnMoZ4jXvEIP1bF-ByZJw9IJT2pWbVh5HctQ', // ⚠️ ต้องตรงกับ Code.gs
    USER_ID_KEY: 'flash_user_id',
    AUTH_KEY: 'flash_auth_data'
};

// ===================== STATE =====================
let userId = null;
let currentUser = null;
let wordPool = [];
let currentWordIndex = 0;
let learnedCount = 0;
let totalWordsInSheet = 0; // จำนวนคำทั้งหมดใน sheet
let hiddenWordsCount = 0; // จำนวนคำที่ซ่อน

// Cache
const CACHE_KEY = 'flash_words_cache';
const CACHE_STATS_KEY = 'flash_stats_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedData(key) {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    try {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_DURATION) {
            return data.value;
        }
        localStorage.removeItem(key);
    } catch (e) {
        localStorage.removeItem(key);
    }
    return null;
}

function setCachedData(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({
            value: value,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.error('Cache error:', e);
    }
}

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

// ===================== AUTH FUNCTIONS =====================
function checkAuth() {
    const authData = localStorage.getItem(CONFIG.AUTH_KEY);
    
    if (authData) {
        try {
            currentUser = JSON.parse(authData);
            showMainApp();
        } catch (e) {
            showLoginScreen();
        }
    } else {
        showLoginScreen();
    }
}

function showLoginScreen() {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const loginBtn = document.getElementById('loginBtn');
    const passwordInput = document.getElementById('password');
    
    if (loginScreen) loginScreen.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
    
    // Event listeners for login (ลบ listener เก่าก่อนเพื่อไม่ให้ซ้อน)
    if (loginBtn) {
        loginBtn.replaceWith(loginBtn.cloneNode(true));
        const newLoginBtn = document.getElementById('loginBtn');
        newLoginBtn.addEventListener('click', handleLogin);
    }
    
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    }
}

function showMainApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    initUserId();
    initEventListeners();
    updateUI();
    
    // แสดงชื่อผู้ใช้
    document.getElementById('currentUsername').textContent = currentUser.username;
}

function handleLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        alert('⚠️ กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
        return;
    }
    
    if (username.length < 3) {
        alert('⚠️ ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');
        return;
    }
    
    if (password.length < 4) {
        alert('⚠️ รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
        return;
    }
    
    // ตรวจสอบ login กับ backend
    const loginBtn = document.getElementById('loginBtn');
    if (!loginBtn) {
        console.error('loginBtn element not found');
        alert('❌ ไม่พบปุ่ม Login');
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = '🔄 กำลังเข้าสู่ระบบ...';
    
    const loginUrl = `${CONFIG.API_URL}?route=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    
    fetch(loginUrl)
        .then(res => {
            return res.json();
        })
        .then(data => {
            if (data.ok && data.user) {
                // เก็บข้อมูล user
                currentUser = data.user;
                localStorage.setItem(CONFIG.AUTH_KEY, JSON.stringify(data.user));
                showMainApp();
            } else {
                alert('❌ ' + (data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
            }
        })
        .catch(err => {
            console.error('Login error:', err);
            alert('❌ เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + err.message);
        })
        .finally(() => {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = '🔐 เข้าสู่ระบบ';
            }
        });
}

function handleLogout() {
    if (confirm('🚪 ต้องการออกจากระบบใช่หรือไม่?')) {
        // ลบทุก cache
        localStorage.removeItem(CONFIG.AUTH_KEY);
        localStorage.removeItem(CACHE_KEY + '_' + userId);
        localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
        currentUser = null;
        window.location.reload();
    }
}

function initUserId() {
    // ใช้ user_id จาก backend แทน
    if (currentUser && currentUser.user_id) {
        userId = currentUser.user_id;
        const userIdElement = document.getElementById('userIdDisplay');
        if (userIdElement) {
            userIdElement.textContent = userId.substring(0, 8);
        }
    } else {
        // fallback ถ้าไม่มี user_id
        userId = crypto.randomUUID();
        const userIdElement = document.getElementById('userIdDisplay');
        if (userIdElement) {
            userIdElement.textContent = userId.substring(0, 8);
        }
    }
}

function initEventListeners() {
    const startBtn = document.getElementById('startBtn');
    const nextBtn = document.getElementById('nextBtn');
    const learnedBtn = document.getElementById('learnedBtn');
    const hideBtn = document.getElementById('hideBtn');
    const showTranslationToggle = document.getElementById('showTranslationToggle');
    const viewHiddenBtn = document.getElementById('viewHiddenBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const hiddenModal = document.getElementById('hiddenModal');
    
    if (startBtn) startBtn.addEventListener('click', handleStart);
    if (nextBtn) nextBtn.addEventListener('click', handleNext);
    if (learnedBtn) learnedBtn.addEventListener('click', handleLearnedAndNext);
    if (hideBtn) hideBtn.addEventListener('click', handleHideAndNext);
    if (showTranslationToggle) showTranslationToggle.addEventListener('change', handleTranslationToggle);
    if (viewHiddenBtn) viewHiddenBtn.addEventListener('click', openHiddenModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeHiddenModal);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // ปิด modal เมื่อคลิกนอก modal-content
    if (hiddenModal) {
        hiddenModal.addEventListener('click', (e) => {
            if (e.target.id === 'hiddenModal') {
                closeHiddenModal();
            }
        });
    }
}

// ===================== API CALLS =====================
async function fetchTotalStats() {
    try {
        // ลอง cache ก่อน
        const cached = getCachedData(CACHE_STATS_KEY + '_' + userId);
        if (cached) {
            return cached;
        }
        
        const url = `${CONFIG.API_URL}?route=stats&userId=${userId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // เก็บ cache
        setCachedData(CACHE_STATS_KEY + '_' + userId, data);
        
        return data;
    } catch (error) {
        console.error('Error fetching stats:', error);
        return { total: 0, hidden: 0, learned: 0 };
    }
}

async function fetchWords() {
    try {
        // ลอง cache ก่อน
        const cached = getCachedData(CACHE_KEY + '_' + userId);
        if (cached) {
            return cached;
        }
        
        const url = `${CONFIG.API_URL}?route=words&limit=200&excludeLearned=1&userId=${userId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        const words = data.data || [];
        
        // เก็บ cache
        setCachedData(CACHE_KEY + '_' + userId, words);
        
        return words;
    } catch (error) {
        console.error('Error fetching words:', error);
        alert('เกิดข้อผิดพลาดในการโหลดคำ: ' + error.message);
        return [];
    }
}

async function saveWordState(wordId, learned = false, hiddenForever = false) {
    try {
        // ใช้ GET แทน POST เพื่อหลีกเลี่ยง CORS preflight
        const url = `${CONFIG.API_URL}?route=save_state&user_id=${userId}&word_id=${wordId}&learned=${learned}&hidden_forever=${hiddenForever}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // ลบ cache เพื่อบังคับ reload ครั้งถัดไป
        localStorage.removeItem(CACHE_KEY + '_' + userId);
        localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
        
        return data;
    } catch (error) {
        console.error('Error saving state:', error);
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
        return null;
    }
}

async function getHiddenWords() {
    try {
        const url = `${CONFIG.API_URL}?route=hidden&userId=${userId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        return data.data || [];
    } catch (error) {
        console.error('Error fetching hidden words:', error);
        alert('เกิดข้อผิดพลาดในการโหลดคำที่ซ่อน: ' + error.message);
        return [];
    }
}

async function unhideWord(wordId) {
    try {
        // ใช้ GET แทน POST เพื่อหลีกเลี่ยง CORS preflight
        const url = `${CONFIG.API_URL}?route=unhide&user_id=${userId}&word_id=${wordId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // ลบ cache
        localStorage.removeItem(CACHE_KEY + '_' + userId);
        localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
        
        return data;
    } catch (error) {
        console.error('Error unhiding word:', error);
        alert('เกิดข้อผิดพลาดในการยกเลิกการซ่อน: ' + error.message);
        return null;
    }
}

// ===================== HANDLERS =====================
async function handleStart() {
    document.getElementById('startBtn').disabled = true;
    document.getElementById('startBtn').textContent = 'กำลังโหลด...';
    
    await loadNewWords();
    
    if (wordPool.length === 0) {
        alert('ไม่มีคำในระบบ กรุณาเพิ่มข้อมูลในชีต words');
        document.getElementById('startBtn').disabled = false;
        document.getElementById('startBtn').textContent = 'เริ่มสุ่ม';
        return;
    }
    
    currentWordIndex = 0;
    showCard();
    
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('cardActions').style.display = 'flex';
}

function handleNext() {
    currentWordIndex++;
    
    if (currentWordIndex >= wordPool.length) {
        showEmptyState();
        return;
    }
    
    showCard();
}

async function handleLearnedAndNext() {
    if (wordPool.length === 0 || currentWordIndex >= wordPool.length) {
        return;
    }
    
    const currentWord = wordPool[currentWordIndex];
    
    // บันทึกว่าจำได้แล้ว (ใช้ learned = true)
    await saveWordState(currentWord.id, true, false);
    
    learnedCount++;
    updateStats();
    
    // ไปใบถัดไป
    handleNext();
}

async function handleHideAndNext() {
    if (wordPool.length === 0 || currentWordIndex >= wordPool.length) {
        return;
    }
    
    const currentWord = wordPool[currentWordIndex];
    
    // บันทึกว่าซ่อนถาวร (ใช้ hidden_forever = true)
    await saveWordState(currentWord.id, false, true);
    
    hiddenWordsCount++;
    updateStats();
    
    // ไปใบถัดไป
    handleNext();
}

function handleTranslationToggle(e) {
    const translationContent = document.getElementById('translationContent');
    
    if (e.target.checked) {
        translationContent.style.display = 'block';
    } else {
        translationContent.style.display = 'none';
    }
}

// ===================== HIDDEN WORDS MODAL =====================
async function openHiddenModal() {
    const modal = document.getElementById('hiddenModal');
    const listContainer = document.getElementById('hiddenWordsList');
    
    modal.style.display = 'flex';
    listContainer.innerHTML = '<p class="loading">กำลังโหลด...</p>';
    
    const hiddenWords = await getHiddenWords();
    
    if (hiddenWords.length === 0) {
        listContainer.innerHTML = '<p class="empty-message">ไม่มีคำที่ซ่อนไว้</p>';
        return;
    }
    
    // แสดงจำนวนคำที่จำได้
    let html = `
        <div class="learned-count-badge">
            <span class="count-icon">🎯</span>
            <span class="count-text">จำได้แล้ว</span>
            <span class="count-number">${hiddenWords.length}</span>
        </div>
        <div class="hidden-words-list">
    `;
    
    hiddenWords.forEach(word => {
        html += `
            <div class="hidden-word-item" data-word-id="${word.id}">
                <div class="word-info">
                    <strong>${word.word}</strong>
                    <span class="translation-small">${word.translation}</span>
                </div>
                <button class="btn btn-unhide" onclick="handleUnhide('${word.id}')">
                    ยกเลิกการจำ
                </button>
            </div>
        `;
    });
    html += '</div>';
    
    listContainer.innerHTML = html;
}

function closeHiddenModal() {
    document.getElementById('hiddenModal').style.display = 'none';
}

async function handleUnhide(wordId) {
    const result = await unhideWord(wordId);
    
    if (result && result.ok) {
        // ลบออกจาก UI
        const item = document.querySelector(`[data-word-id="${wordId}"]`);
        if (item) {
            item.remove();
        }
        
        // เช็คว่าเหลือคำไหมใน modal
        const remainingItems = document.querySelectorAll('.hidden-word-item');
        const badge = document.querySelector('.learned-count-badge .count-number');
        
        if (remainingItems.length === 0) {
            document.getElementById('hiddenWordsList').innerHTML = 
                '<p class="empty-message">ไม่มีคำที่จำได้</p>';
        } else if (badge) {
            // อัปเดทจำนวนในป้าย
            badge.textContent = remainingItems.length;
        }
        
        // รีโหลดคำใหม่ถ้ากำลังเล่นอยู่
        if (document.getElementById('cardActions').style.display !== 'none') {
            // อัปเดตตัวนับ (ลด learnedCount ลง 1)
            if (learnedCount > 0) learnedCount--;
            updateStats();
        }
    }
}

// ===================== UI UPDATE =====================
async function loadNewWords() {
    // ดึงสถิติทั้งหมด
    const stats = await fetchTotalStats();
    totalWordsInSheet = stats.total || 0;
    hiddenWordsCount = stats.hidden || 0;
    learnedCount = stats.learned || 0;
    
    // ดึงคำสำหรับแสดง
    wordPool = await fetchWords();
    
    // สุ่มเพิ่มฝั่ง client
    wordPool = shuffleArray(wordPool);
    
    currentWordIndex = 0;
    updateStats();
    
    if (wordPool.length === 0) {
        showEmptyState();
    } else {
        hideEmptyState();
    }
}

function showCard() {
    if (currentWordIndex >= wordPool.length) {
        showEmptyState();
        return;
    }
    
    const currentWord = wordPool[currentWordIndex];
    
    // แสดงคำหลัก
    const wordElement = document.getElementById('word');
    wordElement.textContent = currentWord.word || '-';
    
    // Auto-scale font based on word length
    const wordLength = (currentWord.word || '').length;
    wordElement.removeAttribute('data-length');
    if (wordLength > 15) {
        wordElement.setAttribute('data-length', 'extra-long');
    } else if (wordLength > 12) {
        wordElement.setAttribute('data-length', 'very-long');
    } else if (wordLength > 8) {
        wordElement.setAttribute('data-length', 'long');
    }
    
    // แสดง POS (Parts of Speech)
    const posTag = document.getElementById('posTag');
    if (posTag) {
        posTag.textContent = currentWord.pos || '-';
        posTag.style.display = currentWord.pos ? 'inline-block' : 'none';
    }
    
    // แสดง Level
    const levelTag = document.getElementById('levelTag');
    if (levelTag) {
        levelTag.textContent = currentWord.level || '-';
        levelTag.style.display = currentWord.level ? 'inline-block' : 'none';
    }
    
    // แสดงคำแปล
    document.getElementById('translationText').textContent = currentWord.translation || '-';
    
    // รีเซ็ต translation toggle (ปิดทุกครั้ง)
    document.getElementById('showTranslationToggle').checked = false;
    document.getElementById('translationContent').style.display = 'none';
    
    hideEmptyState();
    updateStats();
}

function showEmptyState() {
    document.getElementById('flashcard').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('cardActions').style.display = 'none';
}

function hideEmptyState() {
    document.getElementById('flashcard').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

function updateStats() {
    // แสดงจำนวนคำทั้งหมดที่เหลือในระบบ (ไม่นับคำที่ซ่อนหรือจำได้แล้ว)
    const remainingInSystem = totalWordsInSheet - hiddenWordsCount - learnedCount;
    document.getElementById('remainingCount').textContent = Math.max(0, remainingInSystem);
    
    const hiddenWordsCountElement = document.getElementById('hiddenWordsCount');
    if (hiddenWordsCountElement) {
        hiddenWordsCountElement.textContent = hiddenWordsCount;
    }
}

function updateUI() {
    updateStats();
}

// ===================== UTILITIES =====================
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
