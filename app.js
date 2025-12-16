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

// Cache - เพิ่มเวลา cache และใช้ in-memory cache
const CACHE_KEY = 'flash_words_cache';
const CACHE_STATS_KEY = 'flash_stats_cache';
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes (เพิ่มจาก 5)

// In-memory cache สำหรับความเร็ว
const memoryCache = new Map();

function getCachedData(key) {
    // ลองหา in-memory cache ก่อน (เร็วกว่า localStorage)
    if (memoryCache.has(key)) {
        const cached = memoryCache.get(key);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.value;
        }
        memoryCache.delete(key);
    }
    
    // ถ้าไม่มีใน memory ลอง localStorage
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    try {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_DURATION) {
            // เก็บเข้า memory cache ด้วย
            memoryCache.set(key, data);
            return data.value;
        }
        localStorage.removeItem(key);
    } catch (e) {
        localStorage.removeItem(key);
    }
    return null;
}

function setCachedData(key, value) {
    const data = {
        value: value,
        timestamp: Date.now()
    };
    
    // เก็บทั้ง memory และ localStorage
    memoryCache.set(key, data);
    
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error('Cache error:', e);
        // ถ้า localStorage เต็ม ให้ลบ cache เก่า
        try {
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.startsWith('flash_')) {
                    const item = localStorage.getItem(k);
                    if (item) {
                        const parsed = JSON.parse(item);
                        if (Date.now() - parsed.timestamp > CACHE_DURATION) {
                            localStorage.removeItem(k);
                        }
                    }
                }
            });
            // ลองอีกครั้ง
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e2) {
            console.error('Failed to save cache:', e2);
        }
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
    
    // ปิด modal เษื่อคลิกนอก modal-content
    if (hiddenModal) {
        hiddenModal.addEventListener('click', (e) => {
            if (e.target.id === 'hiddenModal') {
                closeHiddenModal();
            }
        });
    }
    
    // Event delegation สำหรับ unhide buttons
    const hiddenWordsList = document.getElementById('hiddenWordsList');
    if (hiddenWordsList) {
        hiddenWordsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-unhide')) {
                const wordId = e.target.getAttribute('data-word-id');
                if (wordId) {
                    handleUnhide(wordId);
                }
            }
        });
    }
}

// ===================== API CALLS =====================
// Request deduplication - ป้องกัน API calls ซ้ำ
const pendingRequests = new Map();

async function fetchTotalStats() {
    try {
        // ลอง cache ก่อน
        const cached = getCachedData(CACHE_STATS_KEY + '_' + userId);
        if (cached) {
            return cached;
        }
        
        // ตรวจสอบว่ากำลังโหลดอยู่หรือไม่
        const requestKey = 'stats_' + userId;
        if (pendingRequests.has(requestKey)) {
            return pendingRequests.get(requestKey);
        }
        
        const url = `${CONFIG.API_URL}?route=stats&userId=${userId}`;
        
        const requestPromise = fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    throw new Error(data.error);
                }
                // เก็บ cache
                setCachedData(CACHE_STATS_KEY + '_' + userId, data);
                return data;
            })
            .finally(() => {
                pendingRequests.delete(requestKey);
            });
        
        pendingRequests.set(requestKey, requestPromise);
        return requestPromise;
    } catch (error) {
        console.error('Error fetching stats:', error);
        return { total: 0, hidden: 0, learned: 0 };
    }
}

async function fetchWords(forceRefresh = false) {
    try {
        // ถ้าไม่บังคับ refresh ให้ลอง cache ก่อน
        if (!forceRefresh) {
            const cached = getCachedData(CACHE_KEY + '_' + userId);
            if (cached) {
                return cached;
            }
        }
        
        // ตรวจสอบว่ากำลังโหลดอยู่หรือไม่
        const requestKey = 'words_' + userId;
        if (pendingRequests.has(requestKey)) {
            return pendingRequests.get(requestKey);
        }
        
        // เพิ่ม timestamp เพื่อป้องกัน browser cache และให้สุ่มคำใหม่ทุกครั้ง
        const timestamp = Date.now();
        const url = `${CONFIG.API_URL}?route=words&limit=200&excludeLearned=1&userId=${userId}&_t=${timestamp}`;
        
        const requestPromise = fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    throw new Error(data.error);
                }
                const words = data.data || [];
                // เก็บ cache
                setCachedData(CACHE_KEY + '_' + userId, words);
                return words;
            })
            .catch(error => {
                console.error('Error fetching words:', error);
                alert('เกิดข้อผิดพลาดในการโหลดคำ: ' + error.message);
                return [];
            })
            .finally(() => {
                pendingRequests.delete(requestKey);
            });
        
        pendingRequests.set(requestKey, requestPromise);
        return requestPromise;
    } catch (error) {
        console.error('Error fetching words:', error);
        alert('เกิดข้อผิดพลาดในการโหลดคำ: ' + error.message);
        return [];
    }
}

// Batch save queue สำหรับ performance
let saveQueue = [];
let saveTimeout = null;

async function saveWordState(wordId, learned = false, hiddenForever = false) {
    try {
        // ใช้ GET แทน POST เพื่อหลีกเลี่ยง CORS preflight
        const url = `${CONFIG.API_URL}?route=save_state&user_id=${userId}&word_id=${wordId}&learned=${learned}&hidden_forever=${hiddenForever}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // ลบ cache เพื่อบังคับ reload ครั้งถัดไป (แต่รอสักครั้ง)
        debouncedCacheClear();
        
        return data;
    } catch (error) {
        console.error('Error saving state:', error);
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
        return null;
    }
}

// Debounced cache clear เพื่อไม่ให้ลบ cache บ่อยเกินไป
const debouncedCacheClear = debounce(() => {
    localStorage.removeItem(CACHE_KEY + '_' + userId);
    localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
    memoryCache.delete(CACHE_KEY + '_' + userId);
    memoryCache.delete(CACHE_STATS_KEY + '_' + userId);
}, 1000);

async function getHiddenWords() {
    try {
        // เพิ่ม cache สำหรับ hidden words
        const cacheKey = 'flash_hidden_cache_' + userId;
        const cached = getCachedData(cacheKey);
        if (cached) {
            return cached;
        }
        
        const url = `${CONFIG.API_URL}?route=hidden&userId=${userId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        const hiddenWords = data.data || [];
        
        // Cache hidden words
        setCachedData(cacheKey, hiddenWords);
        
        return hiddenWords;
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
        
        // ลบ cache ทั้งหมด
        localStorage.removeItem(CACHE_KEY + '_' + userId);
        localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
        localStorage.removeItem('flash_hidden_cache_' + userId);
        
        return data;
    } catch (error) {
        console.error('Error unhiding word:', error);
        alert('เกิดข้อผิดพลาดในการยกเลิกการซ่อน: ' + error.message);
        return null;
    }
}

// ===================== HANDLERS =====================
async function handleStart() {
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = true;
    startBtn.textContent = 'กำลังโหลด...';
    
    // ลบ cache ทั้งหมดเพื่อโหลดคำใหม่ล่าสุดจาก API (รวมถึง hidden words)
    localStorage.removeItem(CACHE_KEY + '_' + userId);
    localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
    localStorage.removeItem('flash_hidden_cache_' + userId);
    memoryCache.delete(CACHE_KEY + '_' + userId);
    memoryCache.delete(CACHE_STATS_KEY + '_' + userId);
    memoryCache.delete('flash_hidden_cache_' + userId);
    
    // โหลดแบบ parallel ทั้ง words และ stats จาก API (บังคับ refresh)
    const [words] = await Promise.all([
        loadNewWords(true),
        fetchTotalStats()
    ]);
    
    if (wordPool.length === 0) {
        alert('ไม่มีคำในระบบ กรุณาเพิ่มข้อมูลในชีต words');
        startBtn.disabled = false;
        startBtn.textContent = 'เริ่มสุ่ม';
        return;
    }
    
    currentWordIndex = 0;
    
    // Prefetch คำถัดไป (ถ้ามี) เพื่อลดเวลารอ
    if (wordPool.length > 1) {
        prefetchNextCard();
    }
    
    showCard();
    
    startBtn.style.display = 'none';
    document.getElementById('cardActions').style.display = 'flex';
}

// ฟังก์ชันยิง API เช็คคำใหม่เมื่อคำในกองหมด
async function reloadAndCheckWords() {
    // แสดง loading
    const nextBtn = document.getElementById('nextBtn');
    const hideBtn = document.getElementById('hideBtn');
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.textContent = '🔄 กำลังโหลด...';
    }
    if (hideBtn) hideBtn.disabled = true;
    
    // ลบ cache ทั้งหมดเพื่อโหลดคำใหม่ล่าสุดจาก API
    localStorage.removeItem(CACHE_KEY + '_' + userId);
    localStorage.removeItem(CACHE_STATS_KEY + '_' + userId);
    localStorage.removeItem('flash_hidden_cache_' + userId);
    memoryCache.delete(CACHE_KEY + '_' + userId);
    memoryCache.delete(CACHE_STATS_KEY + '_' + userId);
    memoryCache.delete('flash_hidden_cache_' + userId);
    
    // ยิง API โหลดคำใหม่ (บังคับ refresh เพื่อเช็คคำที่จำได้แล้ว)
    const newWords = await fetchWords(true);
    
    if (newWords && newWords.length > 0) {
        // มีคำใหม่! โหลดเข้า wordPool
        wordPool = shuffleArray(newWords);
        currentWordIndex = 0;
        
        // อัปเดต stats
        const stats = await fetchTotalStats();
        if (stats) {
            totalWordsInSheet = stats.total || 0;
            hiddenWordsCount = stats.hidden || 0;
            learnedCount = stats.learned || 0;
        }
        updateStats();
        
        // แสดงการ์ดใหม่
        showCard();
        
        // รีเซ็ตปุ่ม
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.textContent = '➡️ ถัดไป';
        }
        if (hideBtn) hideBtn.disabled = false;
    } else {
        // ไม่มีคำเหลือจริงๆ แสดง empty state
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.textContent = '➡️ ถัดไป';
        }
        if (hideBtn) hideBtn.disabled = false;
        showEmptyState();
    }
}

// Prefetch คำถัดไป
function prefetchNextCard() {
    if (currentWordIndex + 1 < wordPool.length) {
        const nextWord = wordPool[currentWordIndex + 1];
        // อาจจะ preload ข้อมูลหรือ prepare DOM ล่วงหน้า
        // สำหรับตอนนี้ เราเก็บไว้ใน memory แล้ว ก็เร็วอยู่แล้ว
    }
}

function handleNext() {
    // เช็คก่อนว่ายังมีคำถัดไปไหม
    if (currentWordIndex + 1 >= wordPool.length) {
        // ไม่มีคำถัดไปในกองแล้ว ยิง API เช็คว่ามีคำใหม่ไหม
        reloadAndCheckWords();
        return;
    }
    
    currentWordIndex++;
    
    // Prefetch คำถัดไป
    if (currentWordIndex + 1 < wordPool.length) {
        prefetchNextCard();
    }
    
    showCard();
}

async function handleLearnedAndNext() {
    if (wordPool.length === 0 || currentWordIndex >= wordPool.length) {
        return;
    }
    
    const currentWord = wordPool[currentWordIndex];
    
    // บันทึกไปยัง API
    await saveWordState(currentWord.id, true, false);
    
    // ลบคำออกจาก wordPool
    wordPool.splice(currentWordIndex, 1);
    
    // ดึงข้อมูล stats ล่าสุดจาก API (background)
    fetchTotalStats().then(stats => {
        if (stats) {
            totalWordsInSheet = stats.total || 0;
            hiddenWordsCount = stats.hidden || 0;
            learnedCount = stats.learned || 0;
            updateStats();
        }
    });
    
    // เช็คว่ายังมีคำเหลือไหม (หลัง splice คำถัดไปจะเลื่อนมาอยู่ที่ index เดิม)
    if (wordPool.length === 0) {
        // ยิง API เช็คว่ามีคำใหม่ไหม
        await reloadAndCheckWords();
        return;
    }
    
    // ถ้า currentWordIndex เกินขอบเขตหลัง splice ให้กลับไปที่คำสุดท้าย
    if (currentWordIndex >= wordPool.length) {
        currentWordIndex = wordPool.length - 1;
    }
    
    // แสดงการ์ดปัจจุบัน (ซึ่งเป็นคำถัดไปที่เลื่อนมาอยู่ที่ index เดิมแล้ว)
    showCard();
}

async function handleHideAndNext() {
    if (wordPool.length === 0 || currentWordIndex >= wordPool.length) {
        return;
    }
    
    // แสดงสถานะโหลดและปิดปุ่มทั้งหมด
    const hideBtn = document.getElementById('hideBtn');
    const nextBtn = document.getElementById('nextBtn');
    const viewHiddenBtn = document.getElementById('viewHiddenBtn');
    
    if (hideBtn) {
        hideBtn.disabled = true;
        hideBtn.textContent = '🔄 กำลังบันทึก...';
    }
    if (nextBtn) nextBtn.disabled = true;
    if (viewHiddenBtn) viewHiddenBtn.disabled = true;
    
    const currentWord = wordPool[currentWordIndex];
    
    // อัปเดตตัวเลขแบบ realtime ทันที
    hiddenWordsCount++;
    updateStats();
    
    try {
        // บันทึกไปยัง API และรอให้เสร็จ
        await saveWordState(currentWord.id, false, true);
        
        // ถ้า modal คำที่จำได้เปิดอยู่ ให้ยิง API ดึงข้อมูลใหม่
        const modal = document.getElementById('hiddenModal');
        if (modal && modal.style.display === 'flex') {
            // ลบ cache ของ hidden words
            localStorage.removeItem('flash_hidden_cache_' + userId);
            memoryCache.delete('flash_hidden_cache_' + userId);
            // รีโหลด modal
            await refreshHiddenModal();
        }
        
        // ลบคำออกจาก wordPool
        wordPool.splice(currentWordIndex, 1);
        
        // เช็คว่ายังมีคำเหลือไหม (หลัง splice คำถัดไปจะเลื่อนมาอยู่ที่ index เดิม)
        if (wordPool.length === 0) {
            // ยิง API เช็คว่ามีคำใหม่ไหม
            await reloadAndCheckWords();
            return;
        }
        
        // ถ้า currentWordIndex เกินขอบเขตหลัง splice ให้กลับไปที่คำสุดท้าย
        if (currentWordIndex >= wordPool.length) {
            currentWordIndex = wordPool.length - 1;
        }
        
        // แสดงการ์ดปัจจุบัน (ซึ่งเป็นคำถัดไปที่เลื่อนมาอยู่ที่ index เดิมแล้ว)
        showCard();
    } finally {
        // คืนสถานะปุ่มกลับ
        if (hideBtn) {
            hideBtn.disabled = false;
            hideBtn.textContent = '✓ จำได้แล้ว';
        }
        if (nextBtn) nextBtn.disabled = false;
        if (viewHiddenBtn) viewHiddenBtn.disabled = false;
    }
}

// ฟังก์ชันรีเฟรช modal คำที่จำได้แล้ว
async function refreshHiddenModal() {
    const listContainer = document.getElementById('hiddenWordsList');
    if (!listContainer) return;
    
    // ยิง API ดึงคำที่จำได้ใหม่
    const hiddenWords = await getHiddenWords();
    
    if (hiddenWords.length === 0) {
        listContainer.innerHTML = '<p class="empty-message">ไม่มีคำที่ซ่อนไว้</p>';
        return;
    }
    
    // ใช้ DocumentFragment สำหรับประสิทธิภาพ
    const fragment = document.createDocumentFragment();
    
    // สร้าง badge
    const badge = document.createElement('div');
    badge.className = 'learned-count-badge';
    badge.innerHTML = `
        <span class="count-icon">🎯</span>
        <span class="count-text">จำได้แล้ว</span>
        <span class="count-number">${hiddenWords.length}</span>
    `;
    fragment.appendChild(badge);
    
    // สร้าง list container
    const wordsListDiv = document.createElement('div');
    wordsListDiv.className = 'hidden-words-list';
    
    // สร้าง word items
    hiddenWords.forEach(word => {
        const item = document.createElement('div');
        item.className = 'hidden-word-item';
        item.setAttribute('data-word-id', word.id);
        
        const wordInfo = document.createElement('div');
        wordInfo.className = 'word-info';
        wordInfo.innerHTML = `
            <strong>${word.word}</strong>
            <span class="translation-small">${word.translation}</span>
        `;
        
        const btn = document.createElement('button');
        btn.className = 'btn btn-unhide';
        btn.textContent = 'ยกเลิกการจำ';
        btn.setAttribute('data-word-id', word.id);
        
        item.appendChild(wordInfo);
        item.appendChild(btn);
        wordsListDiv.appendChild(item);
    });
    
    fragment.appendChild(wordsListDiv);
    
    // อัปเดต DOM ครั้งเดียว
    listContainer.innerHTML = '';
    listContainer.appendChild(fragment);
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
    
    // แสดง skeleton loading แทน
    listContainer.innerHTML = `
        <div class="loading-skeleton">
            <div class="skeleton-item"></div>
            <div class="skeleton-item"></div>
            <div class="skeleton-item"></div>
        </div>
    `;
    
    // ลบ cache เพื่อยิง API ใหม่ทุกครั้งที่เปิด modal
    localStorage.removeItem('flash_hidden_cache_' + userId);
    memoryCache.delete('flash_hidden_cache_' + userId);
    
    const hiddenWords = await getHiddenWords();
    
    if (hiddenWords.length === 0) {
        listContainer.innerHTML = '<p class="empty-message">ไม่มีคำที่ซ่อนไว้</p>';
        return;
    }
    
    // ใช้ DocumentFragment สำหรับประสิทธิภาพ
    const fragment = document.createDocumentFragment();
    
    // สร้าง badge
    const badge = document.createElement('div');
    badge.className = 'learned-count-badge';
    badge.innerHTML = `
        <span class="count-icon">🎯</span>
        <span class="count-text">จำได้แล้ว</span>
        <span class="count-number">${hiddenWords.length}</span>
    `;
    fragment.appendChild(badge);
    
    // สร้าง list container
    const wordsListDiv = document.createElement('div');
    wordsListDiv.className = 'hidden-words-list';
    
    // สร้าง word items - ไม่ใช้ inline event handlers
    hiddenWords.forEach(word => {
        const item = document.createElement('div');
        item.className = 'hidden-word-item';
        item.setAttribute('data-word-id', word.id);
        
        const wordInfo = document.createElement('div');
        wordInfo.className = 'word-info';
        wordInfo.innerHTML = `
            <strong>${word.word}</strong>
            <span class="translation-small">${word.translation}</span>
        `;
        
        const btn = document.createElement('button');
        btn.className = 'btn btn-unhide';
        btn.textContent = 'ยกเลิกการจำ';
        btn.setAttribute('data-word-id', word.id);
        
        item.appendChild(wordInfo);
        item.appendChild(btn);
        wordsListDiv.appendChild(item);
    });
    
    fragment.appendChild(wordsListDiv);
    
    // อัปเดต DOM ครั้งเดียว
    listContainer.innerHTML = '';
    listContainer.appendChild(fragment);
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
        
        // อัปเดต hiddenWordsCount แบบ realtime
        if (hiddenWordsCount > 0) {
            hiddenWordsCount--;
        }
        
        // เช็คว่าเหลือคำไหมใน modal
        const remainingItems = document.querySelectorAll('.hidden-word-item');
        const badge = document.querySelector('.learned-count-badge .count-number');
        
        if (remainingItems.length === 0) {
            document.getElementById('hiddenWordsList').innerHTML = 
                '<p class="empty-message">ไม่มีคำที่จำได้</p>';
        } else if (badge) {
            // อัปเดทจำนวนในป้าย badge แบบ realtime
            badge.textContent = hiddenWordsCount;
        }
        
        // อัปเดต stats ทั้งหมดแบบ realtime
        updateStats();
    }
}

// ===================== UI UPDATE =====================
async function loadNewWords(forceRefresh = false) {
    // ดึงสถิติทั้งหมดจาก API
    const stats = await fetchTotalStats();
    totalWordsInSheet = stats.total || 0;
    hiddenWordsCount = stats.hidden || 0;
    learnedCount = stats.learned || 0;
    
    // ดึงคำจาก API (ใช้ forceRefresh เพื่อเช็คคำที่จำได้แล้ว)
    wordPool = await fetchWords(forceRefresh);
    
    // สุ่มคำใหม่ทุกครั้งเพื่อไม่ให้ซ้ำ
    wordPool = shuffleArray(wordPool);
    
    currentWordIndex = 0;
    updateStats();
    
    // เช็ค empty state อย่างถูกต้อง
    if (wordPool.length === 0) {
        showEmptyState();
    } else {
        hideEmptyState();
    }
    
    return wordPool;
}

function showCard() {
    // เช็คก่อนว่ามีคำเหลือไหม
    if (wordPool.length === 0 || currentWordIndex >= wordPool.length) {
        showEmptyState();
        return;
    }
    
    const currentWord = wordPool[currentWordIndex];
    
    // ป้องกันถ้า currentWord เป็น undefined
    if (!currentWord) {
        console.error('No current word at index:', currentWordIndex, 'Pool length:', wordPool.length);
        showEmptyState();
        return;
    }
    
    // Cache DOM elements
    const wordElement = document.getElementById('word');
    const posTag = document.getElementById('posTag');
    const levelTag = document.getElementById('levelTag');
    const pronunciationText = document.getElementById('pronunciationText');
    const translationText = document.getElementById('translationText');
    const showTranslationToggle = document.getElementById('showTranslationToggle');
    const translationContent = document.getElementById('translationContent');
    
    // Batch DOM updates
    requestAnimationFrame(() => {
        // แสดงคำหลัก (ทำให้ตัวอักษรตัวแรกเป็นตัวใหญ่)
        const word = currentWord.word || '-';
        const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1);
        wordElement.textContent = capitalizedWord;
        
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
        if (posTag) {
            posTag.textContent = currentWord.pos || '-';
            posTag.style.display = currentWord.pos ? 'inline-block' : 'none';
        }
        
        // แสดง Level
        if (levelTag) {
            levelTag.textContent = currentWord.level || '-';
            levelTag.style.display = currentWord.level ? 'inline-block' : 'none';
        }
        
        // แสดง Pronunciation
        if (pronunciationText) {
            pronunciationText.textContent = currentWord.pronunciation || '-';
        }
        
        // แสดงคำแปล
        if (translationText) {
            translationText.textContent = currentWord.translation || '-';
        }
        
        // รีเซ็ต translation toggle (ปิดทุกครั้ง)
        if (showTranslationToggle) {
            showTranslationToggle.checked = false;
        }
        if (translationContent) {
            translationContent.style.display = 'none';
        }
    });
    
    hideEmptyState();
    updateStats();
}

function showEmptyState() {
    document.getElementById('flashcard').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('cardActions').style.display = 'none';
    
    // แสดงปุ่มเริ่มใหม่
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.style.display = 'block';
        startBtn.disabled = false;
        startBtn.textContent = '🔄 โหลดคำใหม่';
    }
}

function hideEmptyState() {
    document.getElementById('flashcard').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
}

// Batch update stats with requestAnimationFrame for better performance
let statsUpdateScheduled = false;

function updateStats() {
    if (statsUpdateScheduled) return;
    
    statsUpdateScheduled = true;
    requestAnimationFrame(() => {
        // แสดงจำนวนคำทั้งหมดที่เหลือในระบบ (ไม่นับคำที่ซ่อนหรือจำได้แล้ว)
        const remainingInSystem = totalWordsInSheet - hiddenWordsCount - learnedCount;
        document.getElementById('remainingCount').textContent = Math.max(0, remainingInSystem);
        
        // แสดงจำนวนคำที่จำได้แล้วจาก API
        const hiddenWordsCountElement = document.getElementById('hiddenWordsCount');
        if (hiddenWordsCountElement) {
            hiddenWordsCountElement.textContent = hiddenWordsCount;
        }
        statsUpdateScheduled = false;
    });
}

function updateUI() {
    updateStats();
}

// ===================== UTILITIES =====================
// Fisher-Yates shuffle - optimized
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
