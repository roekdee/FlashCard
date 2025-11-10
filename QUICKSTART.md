# 🚀 Quick Start Guide

## ขั้นตอนติดตั้งแบบเร็ว (5-10 นาที)

### 1️⃣ สร้าง Google Sheets (2 นาที)

1. ไปที่ https://sheets.google.com
2. สร้าง Google Sheets ใหม่
3. สร้าง 2 sheets:
   - **Sheet 1**: เปลี่ยนชื่อเป็น `words`
   - **Sheet 2**: เปลี่ยนชื่อเป็น `user_state`

4. ใน sheet `words` ใส่หัวตาราง:
   ```
   id | word | translation
   ```

5. ใน sheet `user_state` ใส่หัวตาราง:
   ```
   user_id | word_id | learned | hidden_forever | repetitions | interval | ef | next_due | updated_at
   ```

6. เพิ่มข้อมูลตัวอย่างใน `words` (คัดลอกจาก `SHEETS_TEMPLATE.md`)

7. Copy **SPREADSHEET_ID** จาก URL:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

---

### 2️⃣ Deploy Google Apps Script (3 นาที)

1. ใน Google Sheets → **Extensions** → **Apps Script**
2. ลบโค้ดเดิมทั้งหมด
3. Copy-paste ทั้งหมดจาก `Code.gs`
4. แก้ไข 3 ค่าใน **CONFIG**:
   ```javascript
   const CONFIG = {
     SPREADSHEET_ID: 'ใส่ ID ที่คัดลอกไว้',
     SHEET_WORDS: 'words',
     SHEET_USER_STATE: 'user_state',
     CORS_ORIGIN: 'https://YOUR_GITHUB_USERNAME.github.io',
     API_KEY: 'สร้าง random string ยาวๆ เช่น Kx9mP2vL8nQ4tR7wY3zA5bC1dE6fG0hJ'
   };
   ```

5. กด **💾 Save** (Ctrl+S)
6. กด **Deploy** → **New deployment**:
   - เลือก type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy**
7. Copy **Web app URL** (Deployment ID อยู่ใน URL)
   ```
   https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec
   ```

---

### 3️⃣ Deploy Frontend (GitHub Pages) (3 นาที)

#### Option A: Upload ผ่าน GitHub Web

1. สร้าง GitHub repository ใหม่ (เช่น `oxford-flashcards`)
2. Upload 4 ไฟล์:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `README.md`
3. แก้ไข `app.js` (กดไอคอนดินสอ):
   ```javascript
   const CONFIG = {
       API_URL: 'ใส่ Web app URL จากข้อ 2.7',
       API_KEY: 'ใส่ API Key เดียวกับใน Code.gs',
       USER_ID_KEY: 'flash_user_id'
   };
   ```
4. Commit changes
5. ไปที่ **Settings** → **Pages**
6. Source: เลือก `main` branch → **Save**
7. รอ 1-2 นาที แล้วเข้า `https://YOUR_USERNAME.github.io/oxford-flashcards`

#### Option B: ใช้ Git (ถ้าติดตั้ง Git แล้ว)

```bash
cd flashcard
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/oxford-flashcards.git
git push -u origin main
```

แล้วทำตามข้อ 5-7 ของ Option A

---

### 4️⃣ ทดสอบระบบ

1. เปิด `https://YOUR_USERNAME.github.io/oxford-flashcards`
2. กดปุ่ม **"เริ่มสุ่ม"**
3. ถ้าขึ้นคำ → สำเร็จ! 🎉
4. ถ้าขึ้น Error:
   - เปิด Console (F12)
   - ดูข้อความ error
   - ตรวจสอบ:
     - ✅ SPREADSHEET_ID ถูกต้อง
     - ✅ API_URL และ API_KEY ตรงกันใน Code.gs และ app.js
     - ✅ CORS_ORIGIN ตรงกับโดเมน GitHub Pages

---

## 📝 Checklist

- [ ] สร้าง Google Sheets (2 sheets: words, user_state)
- [ ] เพิ่มข้อมูลตัวอย่างใน sheet words
- [ ] Deploy Google Apps Script (Execute as Me, Anyone)
- [ ] Copy Deployment ID
- [ ] แก้ไข CONFIG ใน Code.gs
- [ ] แก้ไข CONFIG ใน app.js
- [ ] Upload ไฟล์ไป GitHub
- [ ] เปิด GitHub Pages
- [ ] ทดสอบเว็บใช้งานได้

---

## 🐛 แก้ปัญหาที่พบบ่อย

### "Error fetching words"
- ตรวจสอบ `SPREADSHEET_ID` ใน Code.gs
- ตรวจสอบชื่อ sheet เป็น `words` (ตัวพิมพ์เล็ก)
- Re-deploy Apps Script แล้ว copy Deployment ID ใหม่

### "Invalid API Key"
- ตรวจสอบ `API_KEY` ใน Code.gs และ app.js ต้องเหมือนกันทุกตัวอักษร

### CORS Error
- ตรวจสอบ `CORS_ORIGIN` ใน Code.gs
- ต้องเป็น `https://` (ไม่ใช่ http://)
- ต้องไม่มี `/` ท้ายสุด

### ไม่มีคำขึ้นมา
- ตรวจสอบว่าใน sheet `words` มีข้อมูลอย่างน้อย 1 แถว
- ตรวจสอบคอลัมน์: `id`, `word`, `translation` สะกดถูกต้อง

---

## 🎯 พร้อมใช้งาน!

เข้าใช้งานที่: `https://YOUR_USERNAME.github.io/REPO_NAME`

🎓 เริ่มเรียนรู้คำศัพท์ Oxford 3000 ได้เลย!
