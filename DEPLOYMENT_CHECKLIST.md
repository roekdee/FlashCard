# 🚨 แก้ปัญหา 429 Too Many Requests + CORS

## ปัญหาที่พบ:
1. **429 Too Many Requests** - เรียก API บ่อยเกินไป
2. **CORS Error** - Deployment ยังไม่อัพเดท

## ✅ วิธีแก้ (ทำตามลำดับ):

### 1. Deploy Code.gs เวอร์ชันใหม่
**สำคัญมาก! ต้องทำก่อน**

1. เปิด **Apps Script Editor**
2. คลิก **Deploy** → **Manage deployments**
3. คลิก **✏️ Edit** (icon ดินสอ)
4. เปลี่ยน **Version** → **New version**
5. Description: `Fix CORS and rate limit`
6. คลิก **Deploy**
7. ✅ **รอ 1-2 นาที** ให้ deployment พร้อมใช้งาน

---

### 2. ตรวจสอบ Deployment ID
**ตรวจสอบว่า URL ใน app.js ตรงกับ Deployment ID หรือไม่**

ใน `app.js`:
```javascript
API_URL: 'https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec'
```

ใน Apps Script (หลัง deploy):
```
Web App URL: https://script.google.com/macros/s/[DEPLOYMENT_ID]/exec
```

**ต้องตรงกัน!** ถ้าไม่ตรง → copy URL จาก deployment มาใส่ใน app.js

---

### 3. รอให้ Cache หมดอายุ
**Google Apps Script มี cache ประมาณ 5-10 นาที**

- รอ **5 นาที** หลัง deploy
- หรือเปิด URL ใน Incognito/Private mode
- ลบ Browser cache (Ctrl+Shift+Delete)

---

### 4. ทดสอบ API ใน Browser ก่อน

**ทดสอบว่า API ทำงาน:**

Copy URL นี้ไปวางใน browser:
```
https://script.google.com/macros/s/AKfycbxNwerSDLj8cFX6HIIcnFYYvhPyohFL5eUnMoZ4jXvEIP1bF-ByZJw9IJT2pWbVh5HctQ/exec?route=words&limit=10&excludeLearned=0&userId=test
```

**ควรเห็น:**
```json
{
  "data": [
    {"id": "...", "word": "abandon", "pos": "v.", "level": "B2", "translation": "ละทิ้ง"},
    ...
  ]
}
```

**ถ้าเห็น error:**
- `429 Too Many Requests` → รอ 5-10 นาที
- `Unknown route` → Deployment ยังไม่อัพเดท → ทำขั้นตอนที่ 1 อีกครั้ง
- `Users sheet not found` → ตรวจสอบ Google Sheets

---

### 5. เปิดใช้งาน Deployment ที่ถูกต้อง

**ถ้า deploy หลายครั้งอาจมีหลาย deployment:**

1. ไปที่ **Manage deployments**
2. ดู **Active deployments**
3. ถ้ามีหลายอัน:
   - **Archive** deployment เก่า
   - เหลือแค่ deployment ล่าสุด
4. Copy **Web App URL** จาก deployment ที่เหลือ
5. ใส่ใน `app.js` → `API_URL`

---

### 6. ทางเลือก: สร้าง Deployment ใหม่เลย

**ถ้ายังไม่ได้ ให้สร้างใหม่:**

1. **Archive** deployment เดิมทั้งหมด
2. คลิก **Deploy → New deployment**
3. Type: **Web app**
4. Execute as: **Me**
5. Who has access: **Anyone**
6. คลิก **Deploy**
7. Copy **Web App URL** ใหม่
8. แทนที่ใน `app.js`:
```javascript
const CONFIG = {
    API_URL: 'NEW_URL_HERE',
    ...
};
```

---

## 🧪 วิธีทดสอบว่าใช้งานได้:

### Test 1: ทดสอบ API ใน Browser
```
[YOUR_DEPLOYMENT_URL]?route=login&username=admin&password=admin1234
```
ผลลัพธ์: `{"ok":true,"user":{...}}`

### Test 2: ทดสอบ Words
```
[YOUR_DEPLOYMENT_URL]?route=words&limit=5&userId=test
```
ผลลัพธ์: `{"data":[...]}`

### Test 3: ทดสอบในเว็บ
1. Login ด้วย username: admin, password: admin1234
2. กด **🚀 เริ่มสุ่มคำ**
3. ควรเห็นการ์ดคำศัพท์

---

## 📊 สรุป Checklist:

- [ ] Deploy Code.gs version ใหม่
- [ ] รอ 5 นาที ให้ cache หมดอายุ
- [ ] ตรวจสอบ Deployment ID ตรงกัน
- [ ] ทดสอบ API ใน Browser (ควรเห็น JSON)
- [ ] Archive deployment เก่า (ถ้ามีหลายอัน)
- [ ] ลบ Browser cache
- [ ] ทดสอบ Login
- [ ] ทดสอบสุ่มคำ

---

## 🆘 ถ้ายังไม่ได้:

**ส่งข้อมูลเหล่านี้มาให้ผมดู:**
1. Screenshot หน้า "Manage deployments"
2. Web App URL จาก deployment
3. API_URL ใน app.js
4. Error message จาก Console (F12)
