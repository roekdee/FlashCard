# 🚀 Quick Start

ติดตั้งใหม่ทั้งหมดประมาณ 10 นาที ไม่ต้องมีเซิร์ฟเวอร์ ไม่ต้อง build

---

## 1️⃣ สร้าง Supabase project (2 นาที)

1. ไปที่ https://supabase.com → **New project**
2. เลือก region ใกล้ผู้ใช้ (ไทย → `ap-southeast-1` Singapore)
3. รอจน status เป็น **ACTIVE**
4. เก็บค่า 2 อย่างจาก **Project Settings → API**
   - **Project URL** เช่น `https://xxxxxxxx.supabase.co`
   - **Publishable key** (`sb_publishable_…`) — คีย์นี้**ตั้งใจให้อยู่ใน browser** ความปลอดภัยมาจาก RLS ไม่ใช่การซ่อนคีย์
   - ⚠️ อย่าเอา **service_role** key มาใส่ในโค้ดฝั่ง frontend เด็ดขาด

---

## 2️⃣ สร้าง schema (3 นาที)

เปิด **SQL Editor** ใน Supabase แล้วรันไฟล์ใน `supabase/migrations/` **ตามลำดับ**:

| ไฟล์ | ทำอะไร |
|---|---|
| `0001_core_schema.sql` | ตาราง `words` `profiles` `card_states` `reviews` + index + RLS policy |
| `0002_sm2_rpc.sql` | SM-2, คิวทบทวน, สถิติ, ค้นหา — ทั้งหมดเป็นฟังก์ชันใน DB |
| `0003_migrate_from_sheets.sql` | ย้ายข้อมูลจาก Google Sheet เดิม — **ข้ามได้ถ้าติดตั้งใหม่** (ไฟล์เช็คเองแล้วไม่ทำอะไร) |
| `0004_register_user.sql` | สมัครสมาชิกด้วย username |
| `0005_clean_word_column.sql` | ล้าง POS ที่ปนอยู่ในคอลัมน์ `word` |
| `0006_harden_functions.sql` | ปิดช่องที่ database linter เจอ (search_path, สิทธิ์เรียกฟังก์ชัน) |
| `0007_examples_and_dedupe.sql` | คอลัมน์ตัวอย่างประโยค + ลบคำซ้ำ |
| `0008_quiz_newlimit_undo_forecast.sql` | quiz ไม่ให้ตัวเลือกซ้ำความหมาย, เพดานคำใหม่ต่อวัน, undo, forecast |
| `0009_password_signup_rls.sql` | เปลี่ยนรหัสผ่าน, สวิตช์เปิด/ปิดสมัครสมาชิก, เปิด RLS ตารางที่ค้างไว้ |
| `0010_fix_homograph_translations.sql` | แก้คำแปล 14 คำที่ติด marker ตัวเลขและแปลผิดความหมาย |
| `0011_separate_remaining_synonyms.sql` | แยกคำแปลคู่สุดท้ายที่ยังชนกัน |

ถ้าใช้ Supabase CLI: `supabase db push`

---

## 3️⃣ โหลดคำศัพท์ 3,015 คำ (2 นาที)

`supabase/seed/words_01..07.json` คือคลังคำพร้อมคำแปลไทย คำอ่าน และตัวอย่างประโยค

ตาราง `words` ตั้งใจให้เขียนไม่ได้ผ่าน API จึงต้องเปิดสิทธิ์ชั่วคราวตอนโหลด:

```sql
create policy words_seed_ins on public.words for insert to anon with check (true);
create policy words_seed_upd on public.words for update to anon using (true) with check (true);
```

```bash
URL="https://xxxxxxxx.supabase.co/rest/v1/words"
KEY="sb_publishable_xxxxxxxx"
for f in supabase/seed/words_*.json; do
  curl -s -o /dev/null -w "$f -> %{http_code}\n" -X POST "$URL" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=minimal" \
    --data-binary "@$f"
done
```

**ปิดสิทธิ์ทันทีที่โหลดเสร็จ** (ข้อนี้ห้ามลืม — ถ้าค้างไว้ ใครก็เขียนคลังคำได้):

```sql
drop policy words_seed_ins on public.words;
drop policy words_seed_upd on public.words;
select count(*) from public.words;   -- ควรได้ 3015
```

---

## 4️⃣ ตั้งค่า frontend (1 นาที)

แก้ `api.js` บรรทัดบนสุด:

```javascript
export const CONFIG = {
    SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
    SUPABASE_KEY: 'sb_publishable_xxxxxxxx',
    EMAIL_DOMAIN: 'oxford3000.local',
    QUEUE_SIZE: 40
};
```

---

## 5️⃣ Deploy (2 นาที)

### GitHub Pages
1. push ไฟล์ทั้งหมดขึ้น repo
2. **Settings → Pages** → Source: branch `main` → **Save**
3. เข้า `https://YOUR_USERNAME.github.io/REPO_NAME`

### รันในเครื่อง
```bash
python -m http.server 8777
```
แล้วเปิด http://127.0.0.1:8777

> ⚠️ เปิดไฟล์แบบ `file://` ไม่ได้ — โค้ดใช้ ES modules กับ service worker ต้องมี http(s)

---

## 6️⃣ สมัครผู้ใช้คนแรก

กด **สมัครสมาชิก** ที่หน้า login (ชื่อผู้ใช้ `a-z 0-9 _` ยาว 3-32 · รหัสผ่านอย่างน้อย 8 ตัว)

หรือสร้างจาก SQL Editor:
```sql
select public.register_user('yourname', 'yourpassword');
```

---

## 🐛 แก้ปัญหาที่พบบ่อย

### `Database error querying schema` ตอน login
มี row ใน `auth.users` ที่คอลัมน์ token เป็น `NULL` — GoTrue อ่านเป็น Go string ไม่ได้ เกิดตอน insert เข้า `auth.users` เองโดยไม่ใส่ค่า:
```sql
update auth.users set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token     = coalesce(recovery_token, ''),
  email_change       = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change       = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, '');
```

### `Email address is invalid` ตอนสมัคร
แปลว่ามีอะไรเรียก `supabase.auth.signUp()` อยู่ — GoTrue ไม่รับโดเมน `.local` แอปนี้ใช้ `register_user()` แทน (ดู `api.js`)

### ไม่มีคำขึ้นมา / `remaining` เป็น 0
- `select count(*) from public.words;` ได้ 0 → ยังไม่ได้โหลด seed (ข้อ 3)
- มีคำแต่ไม่ขึ้น → ตัวกรองระดับ/ชนิดคำเปิดค้างอยู่ กดเอาออก

### `permission denied for function …`
ยังไม่ได้รัน `grant execute` ท้ายไฟล์ `0002` — รัน `0002_sm2_rpc.sql` ซ้ำได้ ปลอดภัย (ทุกฟังก์ชันเป็น `create or replace`)

### PWA ติดตั้งไม่ขึ้น
ต้องเป็น `https://` หรือ `localhost` เท่านั้น และต้องโหลด `sw.js` กับ `manifest.webmanifest` ได้

---

## 🔒 ปิดรับสมัครสมาชิก

เว็บ public = ใครก็กดสมัครได้ (จำกัดรวม 500 บัญชี) ถ้าไม่อยากให้สมัคร:

```sql
update public.app_settings set allow_signup = false, updated_at = now();
```

เปิดกลับด้วย `allow_signup = true` — ผู้ใช้เดิมยัง login ได้ตามปกติทั้งสองกรณี

---

## ✅ Checklist

- [ ] Supabase project ACTIVE
- [ ] รัน migration 0001, 0002, 0004-0011 (0003 ข้ามได้ถ้าติดตั้งใหม่)
- [ ] โหลด seed แล้วได้ 3015 คำ
- [ ] **ลบ policy `words_seed_ins` และ `words_seed_upd` แล้ว**
- [ ] ใส่ URL + publishable key ใน `api.js`
- [ ] สมัคร user แล้ว login ได้
- [ ] กด "เริ่มทบทวน" แล้วมีการ์ดขึ้น
