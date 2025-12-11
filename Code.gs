/**
 * Oxford 3000 Flashcards - Google Apps Script Backend
 * 
 * Deploy: Web App → Execute as: Me → Who has access: Anyone
 */

// ===================== CONFIG =====================
const CONFIG = {
  SPREADSHEET_ID: '1iiaWg7i53ryMLbUk3fZTGyTL-SiBnM1vtis6eA-CCUs', // ⚠️ แก้ไขตรงนี้
  SHEET_WORDS: 'words',
  SHEET_USER_STATE: 'user_state',
  SHEET_USERS: 'users',
  CORS_ORIGIN: '*', // อนุญาตทุก origin (สำหรับ test ใน localhost)
  API_KEY: '<YOUR_RANDOM_API_KEY>', // ⚠️ สร้าง random string ยาวๆ
  CACHE_DURATION: 300 // 5 minutes cache
};

// ===================== POS NORMALIZATION =====================
const POS_MAP = {
  'n.': 'noun',
  'v.': 'verb',
  'adj.': 'adjective',
  'adv.': 'adverb',
  'prep.': 'preposition',
  'pron.': 'pronoun',
  'det.': 'determiner',
  'conj.': 'conjunction',
  'exclam.': 'exclamation',
  'number': 'number',
  'modal v.': 'modal-verb',
  'auxiliary v.': 'auxiliary-verb'
};

// ===================== CACHE HELPERS =====================
function getCacheKey(key) {
  return 'flashcard_' + key;
}

function getFromCache(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(getCacheKey(key));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function setToCache(key, value, duration) {
  const cache = CacheService.getScriptCache();
  try {
    cache.put(getCacheKey(key), JSON.stringify(value), duration || CONFIG.CACHE_DURATION);
  } catch (e) {
    Logger.log('Cache error: ' + e);
  }
}

function clearCache(key) {
  const cache = CacheService.getScriptCache();
  cache.remove(getCacheKey(key));
}

// ===================== MAIN HANDLER =====================
function doGet(e) {
  const route = e.parameter.route || e.parameter.action;
  
  try {
    let response;
    
    if (route === 'words') {
      response = handleGetWords(e);
    } else if (route === 'state') {
      response = handleGetState(e);
    } else if (route === 'hidden') {
      response = handleGetHidden(e);
    } else if (route === 'login') {
      response = handleLogin(e);
    } else if (route === 'save_state') {
      // รองรับ save_state ผ่าน GET เพื่อหลีกเลี่ยง CORS preflight
      const payload = {
        user_id: e.parameter.user_id,
        word_id: e.parameter.word_id,
        learned: e.parameter.learned === 'true',
        hidden_forever: e.parameter.hidden_forever === 'true'
      };
      response = handleSaveState(payload);
    } else if (route === 'unhide') {
      // รองรับ unhide ผ่าน GET
      const payload = {
        user_id: e.parameter.user_id,
        word_id: e.parameter.word_id
      };
      response = handleUnhide(payload);
    } else if (route === 'stats') {
      // สถิติรวม: จำนวนคำทั้งหมด, ซ่อน, จำได้แล้ว
      response = handleGetStats(e);
    } else {
      response = { error: 'Unknown route: ' + route };
    }
    
    return createResponse(response);
  } catch (error) {
    return createResponse({ error: error.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // ตรวจสอบ API Key
    if (data.apiKey !== CONFIG.API_KEY) {
      return createResponse({ error: 'Invalid API Key' }, 403);
    }
    
    if (data.action === 'save_state') {
      const result = handleSaveState(data.payload);
      return createResponse(result);
    } else if (data.action === 'unhide') {
      const result = handleUnhide(data.payload);
      return createResponse(result);
    }
    
    return createResponse({ error: 'Unknown action' });
  } catch (error) {
    return createResponse({ error: error.toString() }, 500);
  }
}

// ===================== LOGIN =====================
function handleLogin(e) {
  const username = e.parameter.username || '';
  const password = e.parameter.password || '';
  
  if (!username || !password) {
    return { ok: false, error: 'Username and password required' };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  
  if (!usersSheet) {
    return { ok: false, error: 'Users sheet not found' };
  }
  
  const usersData = usersSheet.getDataRange().getValues();
  const headers = usersData[0];
  const colIndexes = {};
  headers.forEach((h, i) => { colIndexes[h] = i; });
  
  // หา user ที่ตรงกับ username
  for (let i = 1; i < usersData.length; i++) {
    const row = usersData[i];
    const dbUsername = row[colIndexes.username];
    const dbPassword = row[colIndexes.password];
    const userId = row[colIndexes.user_id];
    
    if (dbUsername === username && dbPassword === password) {
      return {
        ok: true,
        user: {
          user_id: userId,
          username: dbUsername
        }
      };
    }
  }
  
  return { ok: false, error: 'Invalid username or password' };
}

// ===================== PARSE WORD STRING =====================
// แยก word string เช่น "abandon v. B2" เป็น { word, pos, level }
function parseWordString(wordStr) {
  if (!wordStr || wordStr === '') return null;
  
  const parts = wordStr.trim().split(/\s+/);
  if (parts.length === 0) return null;
  
  // คำแรก = คำหลัก
  const word = parts[0];
  
  // หา POS (เช่น v., n., adj., adv.)
  let pos = '';
  let level = '';
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    // ตรวจสอบว่าเป็น POS หรือไม่
    if (part.includes('.') || ['prep', 'pron', 'det', 'conj', 'exclam', 'number', 'modal', 'auxiliary'].includes(part)) {
      pos = part;
    }
    // ตรวจสอบว่าเป็น Level (A1, A2, B1, B2, C1, C2)
    else if (/^[ABC][12]$/i.test(part)) {
      level = part.toUpperCase();
    }
  }
  
  return { word, pos, level };
}

// ===================== AUTO-TRANSLATE =====================
function translateWord(word, targetLang = 'th') {
  try {
    // ใช้ Google Translate API ที่มีใน Apps Script
    const translation = LanguageApp.translate(word, 'en', targetLang);
    return translation;
  } catch (error) {
    Logger.log('Translation error: ' + error);
    return '';
  }
}

// ===================== AUTO-GENERATE DATA =====================
function autoGenerateData() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const wordsSheet = ss.getSheetByName(CONFIG.SHEET_WORDS);
  const wordsData = wordsSheet.getDataRange().getValues();
  
  const headers = wordsData[0];
  const colIndexes = {};
  headers.forEach((h, i) => { colIndexes[h] = i; });
  
  let updated = 0;
  let translationCount = 0;
  const MAX_TRANSLATIONS = 10; // จำกัดการแปลครั้งละไม่เกิน 10 คำ
  
  for (let i = 1; i < wordsData.length; i++) {
    const row = wordsData[i];
    const currentId = row[colIndexes.id];
    const wordStr = row[colIndexes.word];
    
    if (!wordStr || wordStr === '') continue;
    
    // แยกคำหลักออกมา
    const parsed = parseWordString(wordStr);
    const cleanWord = parsed ? parsed.word : wordStr;
    
    // 1. สร้าง ID ถ้ายังไม่มี
    if (!currentId || currentId === '') {
      const newId = Utilities.getUuid();
      wordsSheet.getRange(i + 1, colIndexes.id + 1).setValue(newId);
      updated++;
    }
    
    // 2. แยก POS ถ้ายังไม่มี
    const currentPos = row[colIndexes.Parts_of_Speech];
    if (!currentPos || currentPos === '') {
      if (parsed && parsed.pos) {
        wordsSheet.getRange(i + 1, colIndexes.Parts_of_Speech + 1).setValue(parsed.pos);
        updated++;
      }
    }
    
    // 3. แยก Level ถ้ายังไม่มี
    const currentLevel = row[colIndexes.Level];
    if (!currentLevel || currentLevel === '') {
      if (parsed && parsed.level) {
        wordsSheet.getRange(i + 1, colIndexes.Level + 1).setValue(parsed.level);
        updated++;
      }
    }
    
    // 4. แปลภาษาอัตโนมัติถ้ายังไม่มี (จำกัดจำนวนเพื่อหลีกเลี่ยง rate limit)
    const currentTranslation = row[colIndexes.translation];
    if (!currentTranslation || currentTranslation === '') {
      if (translationCount < MAX_TRANSLATIONS) {
        const translation = translateWord(cleanWord);
        if (translation) {
          wordsSheet.getRange(i + 1, colIndexes.translation + 1).setValue(translation);
          updated++;
          translationCount++;
          // หน่วง 0.5 วินาที เพื่อไม่ให้โดน rate limit
          Utilities.sleep(500);
        }
      }
    }
  }
  
  return { ok: true, updated: updated, translated: translationCount };
}

// ===================== GET WORDS =====================
function handleGetWords(e) {
  const limit = parseInt(e.parameter.limit) || 200;
  const excludeLearned = e.parameter.excludeLearned === '1';
  const userId = e.parameter.userId || '';
  const autoGen = e.parameter.autoGen === '1';
  
  // ลอง cache ก่อน (ไม่ cache ถ้ามี userId เพราะแต่ละ user ต่างกัน)
  const cacheKey = excludeLearned && userId ? `words_${userId}_${limit}` : `words_all_${limit}`;
  const cached = getFromCache(cacheKey);
  if (cached && !autoGen) {
    return { data: cached };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const wordsSheet = ss.getSheetByName(CONFIG.SHEET_WORDS);
  
  if (autoGen) {
    autoGenerateData();
  }
  
  // ใช้ getDataRange() แทน getRange() + getValues() เพื่อประสิทธิภาพ
  const wordsData = wordsSheet.getDataRange().getValues();
  
  // Cache headers mapping
  const headers = wordsData[0];
  const colIndexes = {};
  for (let i = 0; i < headers.length; i++) {
    colIndexes[headers[i]] = i;
  }
  
  // Pre-allocate array size
  let words = [];
  const dataLength = wordsData.length;
  
  // อ่านคำทั้งหมดในครั้งเดียว
  for (let i = 1; i < dataLength; i++) {
    const row = wordsData[i];
    const wordStr = row[colIndexes.word];
    if (!wordStr) continue;
    
    const parsed = parseWordString(wordStr);
    const cleanWord = parsed ? parsed.word : wordStr;
    
    const word = {
      id: row[colIndexes.id] || '',
      word: cleanWord,
      pos: row[colIndexes.Parts_of_Speech] || '',
      level: row[colIndexes.Level] || '',
      pronunciation: row[colIndexes.pronunciation] || '',
      translation: row[colIndexes.translation] || ''
    };
    
    if (!word.id) continue;
    words.push(word);
  }
  
  // ตัดคำที่ learned ออก
  if (excludeLearned && userId) {
    const excludedIds = getExcludedWordIds(userId);
    words = words.filter(w => !excludedIds.has(w.id));
  }
  
  // สุ่ม
  words = shuffleArray(words);
  
  // จำกัดจำนวน
  words = words.slice(0, limit);
  
  // Cache result
  setToCache(cacheKey, words);
  
  return { data: words };
}

// ===================== GET STATE =====================
function handleGetState(e) {
  const userId = e.parameter.userId || '';
  
  if (!userId) {
    return { error: 'userId required' };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  const stateData = stateSheet.getDataRange().getValues();
  
  const headers = stateData[0];
  const colIndexes = {};
  headers.forEach((h, i) => { colIndexes[h] = i; });
  
  const userStates = [];
  for (let i = 1; i < stateData.length; i++) {
    const row = stateData[i];
    if (row[colIndexes.user_id] === userId) {
      userStates.push({
        word_id: row[colIndexes.word_id],
        learned: row[colIndexes.learned] === true || row[colIndexes.learned] === 'TRUE',
        hidden_forever: row[colIndexes.hidden_forever] === true || row[colIndexes.hidden_forever] === 'TRUE',
        repetitions: row[colIndexes.repetitions] || 0,
        interval: row[colIndexes.interval] || 0,
        ef: row[colIndexes.ef] || 2.5,
        next_due: row[colIndexes.next_due] || '',
        updated_at: row[colIndexes.updated_at] || ''
      });
    }
  }
  
  return { data: userStates };
}

// ===================== GET STATS =====================
function handleGetStats(e) {
  const userId = e.parameter.userId || '';
  
  if (!userId) {
    return { error: 'userId required' };
  }
  
  // ลอง cache ก่อน
  const cacheKey = `stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const wordsSheet = ss.getSheetByName(CONFIG.SHEET_WORDS);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  
  // นับจำนวนคำทั้งหมดใน sheet words (ใช้ getLastRow แทน)
  const lastRow = wordsSheet.getLastRow();
  let totalWords = 0;
  
  if (lastRow > 1) {
    const wordsColumn = wordsSheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < wordsColumn.length; i++) {
      if (wordsColumn[i][0]) totalWords++;
    }
  }
  
  // นับจำนวนคำที่ซ่อนและจำได้แล้ว
  const stateData = stateSheet.getDataRange().getValues();
  const headers = stateData[0];
  const colIndexes = {};
  for (let i = 0; i < headers.length; i++) {
    colIndexes[headers[i]] = i;
  }
  
  let hiddenCount = 0;
  let learnedCount = 0;
  
  for (let i = 1; i < stateData.length; i++) {
    const row = stateData[i];
    if (row[colIndexes.user_id] === userId) {
      const hidden = row[colIndexes.hidden_forever] === true || row[colIndexes.hidden_forever] === 'TRUE';
      const learned = row[colIndexes.learned] === true || row[colIndexes.learned] === 'TRUE';
      
      if (hidden) hiddenCount++;
      if (learned) learnedCount++;
    }
  }
  
  const result = {
    total: totalWords,
    hidden: hiddenCount,
    learned: learnedCount,
    remaining: totalWords - hiddenCount - learnedCount
  };
  
  // Cache result for 1 minute
  setToCache(cacheKey, result, 60);
  
  return result;
}

// ===================== SAVE STATE =====================
function handleSaveState(payload) {
  const { user_id, word_id, learned, hidden_forever } = payload;
  
  if (!user_id || !word_id) {
    return { error: 'user_id and word_id required' };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  const stateData = stateSheet.getDataRange().getValues();
  
  const headers = stateData[0];
  const colIndexes = {};
  for (let i = 0; i < headers.length; i++) {
    colIndexes[headers[i]] = i;
  }
  
  // หาแถวที่มีอยู่แล้ว
  let existingRow = -1;
  for (let i = 1; i < stateData.length; i++) {
    if (stateData[i][colIndexes.user_id] === user_id && 
        stateData[i][colIndexes.word_id] === word_id) {
      existingRow = i + 1; // 1-indexed
      break;
    }
  }
  
  const now = new Date().toISOString();
  
  if (existingRow > 0) {
    // อัปเดต (ใช้ batch update)
    const updates = [];
    if (learned !== undefined) {
      updates.push([existingRow, colIndexes.learned + 1, learned]);
    }
    if (hidden_forever !== undefined) {
      updates.push([existingRow, colIndexes.hidden_forever + 1, hidden_forever]);
    }
    updates.push([existingRow, colIndexes.updated_at + 1, now]);
    
    // Apply all updates at once
    updates.forEach(([row, col, val]) => {
      stateSheet.getRange(row, col).setValue(val);
    });
  } else {
    // เพิ่มใหม่
    const newRow = [
      user_id,
      word_id,
      learned === true,
      hidden_forever === true,
      0, // repetitions
      0, // interval
      2.5, // ef
      '', // next_due
      now
    ];
    stateSheet.appendRow(newRow);
  }
  
  // Clear cache for this user
  clearCache(`stats_${user_id}`);
  clearCache(`words_${user_id}_200`);
  clearCache(`hidden_${user_id}`);
  
  return { ok: true };
}

// ===================== GET HIDDEN WORDS =====================
function handleGetHidden(e) {
  const userId = e.parameter.userId || '';
  
  if (!userId) {
    return { error: 'userId required' };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  const wordsSheet = ss.getSheetByName(CONFIG.SHEET_WORDS);
  
  const stateData = stateSheet.getDataRange().getValues();
  const wordsData = wordsSheet.getDataRange().getValues();
  
  // สร้าง map ของคำทั้งหมด
  const wordsMap = {};
  const wordHeaders = wordsData[0];
  const wordColIndexes = {};
  wordHeaders.forEach((h, i) => { wordColIndexes[h] = i; });
  
  for (let i = 1; i < wordsData.length; i++) {
    const row = wordsData[i];
    const id = row[wordColIndexes.id];
    if (id) {
      wordsMap[id] = {
        id: id,
        word: row[wordColIndexes.word],
        translation: row[wordColIndexes.translation] || ''
      };
    }
  }
  
  // หาคำที่ซ่อน
  const stateHeaders = stateData[0];
  const stateColIndexes = {};
  stateHeaders.forEach((h, i) => { stateColIndexes[h] = i; });
  
  const hiddenWords = [];
  for (let i = 1; i < stateData.length; i++) {
    const row = stateData[i];
    if (row[stateColIndexes.user_id] === userId) {
      const hidden = row[stateColIndexes.hidden_forever] === true || row[stateColIndexes.hidden_forever] === 'TRUE';
      if (hidden) {
        const wordId = row[stateColIndexes.word_id];
        if (wordsMap[wordId]) {
          hiddenWords.push(wordsMap[wordId]);
        }
      }
    }
  }
  
  return { data: hiddenWords };
}

// ===================== UNHIDE WORD =====================
function handleUnhide(payload) {
  const { user_id, word_id } = payload;
  
  if (!user_id || !word_id) {
    return { error: 'user_id and word_id required' };
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  const stateData = stateSheet.getDataRange().getValues();
  
  const headers = stateData[0];
  const colIndexes = {};
  headers.forEach((h, i) => { colIndexes[h] = i; });
  
  // หาแถว
  for (let i = 1; i < stateData.length; i++) {
    if (stateData[i][colIndexes.user_id] === user_id && 
        stateData[i][colIndexes.word_id] === word_id) {
      const rowNum = i + 1; // 1-indexed
      
      // ตั้งค่า hidden_forever เป็น false
      stateSheet.getRange(rowNum, colIndexes.hidden_forever + 1).setValue(false);
      stateSheet.getRange(rowNum, colIndexes.learned + 1).setValue(false);
      stateSheet.getRange(rowNum, colIndexes.updated_at + 1).setValue(new Date().toISOString());
      
      return { ok: true };
    }
  }
  
  return { error: 'Word state not found' };
}

// ===================== HELPERS =====================
function getExcludedWordIds(userId) {
  // ลอง cache ก่อน
  const cacheKey = `excluded_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return new Set(cached);
  }
  
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const stateSheet = ss.getSheetByName(CONFIG.SHEET_USER_STATE);
  const stateData = stateSheet.getDataRange().getValues();
  
  const headers = stateData[0];
  const colIndexes = {};
  for (let i = 0; i < headers.length; i++) {
    colIndexes[headers[i]] = i;
  }
  
  const excludedArray = [];
  for (let i = 1; i < stateData.length; i++) {
    const row = stateData[i];
    if (row[colIndexes.user_id] === userId) {
      const learned = row[colIndexes.learned] === true || row[colIndexes.learned] === 'TRUE';
      const hidden = row[colIndexes.hidden_forever] === true || row[colIndexes.hidden_forever] === 'TRUE';
      if (learned || hidden) {
        excludedArray.push(row[colIndexes.word_id]);
      }
    }
  }
  
  // Cache the array (Sets can't be cached directly)
  setToCache(cacheKey, excludedArray, 60);
  
  return new Set(excludedArray);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createResponse(data, statusCode = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  
  // Note: Google Apps Script Web Apps handle CORS automatically
  // CORS_ORIGIN in CONFIG is mainly for documentation
  return output;
}

// ===================== MANUAL TRIGGER =====================
// รันฟังก์ชันนี้ใน Apps Script Editor เพื่อแปลภาษาทั้งหมด
function generateAllData() {
  let totalUpdated = 0;
  let hasMore = true;
  let round = 0;
  
  while (hasMore) {
    round++;
    Logger.log('Round ' + round + ': Starting...');
    
    const result = autoGenerateData();
    totalUpdated += result.updated;
    
    Logger.log('Round ' + round + ': Updated ' + result.updated + ' items, Translated ' + result.translated + ' words');
    
    // ถ้าแปลได้น้อยกว่า 10 คำ แสดงว่าใกล้เสร็จแล้ว
    if (result.translated < 10) {
      hasMore = false;
    }
    
    // รอ 2 วินาที ก่อนรอบถัดไป
    if (hasMore) {
      Utilities.sleep(2000);
    }
  }
  
  Logger.log('=== COMPLETED ===');
  Logger.log('Total updated: ' + totalUpdated);
  return { ok: true, totalUpdated: totalUpdated };
}

// Note: Google Apps Script Web Apps automatically handle CORS for configured origins
// For additional CORS control, you may need to use UrlFetchApp or configure in deployment settings
