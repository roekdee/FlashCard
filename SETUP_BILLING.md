# 💳 เปิดระบบสมาชิก Pro + Google login + รีเซ็ตรหัสผ่าน

โค้ดและ schema พร้อมหมดแล้ว เหลือ 4 อย่างที่ **ต้องทำเอง** เพราะเป็นคีย์ลับและบัญชีของคุณ

> ⚠️ อย่าส่งคีย์ลับ (`skey_…`, service_role, client secret) มาในแชต — ใส่ในหน้าเว็บของผู้ให้บริการโดยตรง

---

## 1️⃣ Omise — คีย์และ webhook

1. สมัคร/เข้า https://dashboard.omise.co → **Keys**
   - `pkey_test_…` = **public key** อยู่ในเบราว์เซอร์ได้ ปลอดภัย
   - `skey_test_…` = **secret key** ห้ามหลุด

2. ใส่ **public key** ลง DB (Supabase → SQL Editor):
   ```sql
   update public.app_settings
      set omise_public_key = 'pkey_test_xxxxxxxx',
          billing_live     = false;   -- true เมื่อสลับไปคีย์ live
   ```

   เช็คสถานะการตั้งค่าทั้งหมดได้ด้วย:
   ```sql
   select omise_public_key is not null as omise_ready,
          billing_live, google_enabled, allow_signup
   from public.app_settings;
   ```

3. ใส่ **secret key** เป็น Edge Function secret
   Supabase → **Edge Functions → Secrets → Add new secret**
   | Name | Value |
   |---|---|
   | `OMISE_SECRET_KEY` | `skey_test_xxxxxxxx` |

   *ผมไม่แตะคีย์นี้ ฟังก์ชันอ่านจาก env เท่านั้น*

4. ตั้ง webhook: Omise Dashboard → **Webhooks → Add endpoint**
   ```
   https://xixvrekqkikxrzrinjko.supabase.co/functions/v1/omise-webhook
   ```
   เลือก event `charge.complete` (จะส่งทุก event ก็ได้ ตัวที่ไม่เกี่ยวถูกตอบ 200 ทิ้ง)

**ทดสอบ:** บัตรทดสอบของ Omise `4242 4242 4242 4242` วันหมดอายุอนาคต CVC อะไรก็ได้
PromptPay ในโหมด test จะได้ QR ปลอมที่กดจ่ายได้จากหน้า dashboard

---

## 2️⃣ SMTP — เพื่อให้รีเซ็ตรหัสผ่านและยืนยันอีเมลทำงาน

Supabase free tier ส่งได้ ~2 ฉบับ/ชั่วโมง ใช้จริงไม่ไหว

1. สมัคร https://resend.com (ฟรี 3,000 ฉบับ/เดือน) → ยืนยันโดเมนหรือใช้ `onboarding@resend.dev` ตอนทดสอบ
2. Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**
   | ช่อง | ค่า |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | API key ของ Resend |
   | Sender email | อีเมลบนโดเมนที่ยืนยันแล้ว |

3. **Authentication → URL Configuration**
   - Site URL: `https://oxford3000-flashcards.netlify.app`
   - Redirect URLs: เพิ่ม `https://oxford3000-flashcards.netlify.app/**` และ `http://127.0.0.1:8777/**` (ไว้ทดสอบ)

---

## 3️⃣ Google login

1. https://console.cloud.google.com → **APIs & Services → Credentials → Create OAuth client ID → Web application**
2. Authorized redirect URI:
   ```
   https://xixvrekqkikxrzrinjko.supabase.co/auth/v1/callback
   ```
3. Supabase → **Authentication → Providers → Google** → เปิด แล้วใส่ Client ID + Client Secret
4. เปิดปุ่มในหน้า login:
   ```sql
   update public.app_settings set google_enabled = true;
   ```

**ปุ่ม Google ถูกซ่อนไว้จนกว่าจะรัน SQL ข้อ 4** — กันไม่ให้ผู้ใช้เจอปุ่มที่กดแล้วขึ้น
`Unsupported provider: provider is not enabled` ทำข้อ 1-3 ให้เสร็จก่อนค่อยเปิด

---

## 4️⃣ ยืนยันอีเมลตอนสมัคร — เปิดหรือปิด

**Authentication → Providers → Email → Confirm email**

- **ปิด** — สมัครเสร็จเข้าใช้ได้เลย ลื่นกว่า แต่ใครก็กรอกอีเมลมั่วได้
- **เปิด** — ต้องกดลิงก์ในเมลก่อน (ต้องทำข้อ 2 ก่อน) แอปรองรับทั้งสองแบบ ขึ้นข้อความ *"เปิดลิงก์ยืนยันในอีเมลก่อนเข้าสู่ระบบ"* ให้เอง

---

## 📋 สิ่งที่ Free / Pro ได้

| | Free | Pro |
|---|---|---|
| คลังคำ | A1–A2 (1,496 คำ) | ครบ 3,015 คำ |
| คำใหม่ต่อวัน | 10 | ไม่จำกัด (ตั้งเองได้) |
| โหมดเรียน | พลิกการ์ด | + เลือก 4 ตัวเลือก, พิมพ์คำตอบ |
| สถิติ | ตัวเลขพื้นฐาน | + heatmap 1 ปี, forecast 7 วัน, วันต่อเนื่อง |
| กระดานจัดอันดับ | ❌ | ✅ |
| เหรียญตรา | เห็นความคืบหน้า | เห็นความคืบหน้า |

แก้ราคา/แพ็กเกจ:
```sql
update public.billing_plans set amount_satang = 12900 where code = 'pro_1m';
```

แก้ว่า Free ได้อะไร:
```sql
update public.plan_limits
   set new_per_day_cap = 15, levels = array['A1','A2','B1']
 where plan = 'free';
```

---

## 🛠️ งานประจำ

**แถม Pro ให้ใครสักคน** (ไม่ต้องจ่าย):
```sql
select public.extend_pro(
  (select id from public.profiles where username = 'someone'), 3);   -- 3 เดือน
```

**ดูรายการชำระเงินทั้งหมด:**
```sql
select b.created_at, p.username, b.amount_satang / 100 as baht,
       b.months, b.method, b.pro_until_after
from public.billing_events b
left join public.profiles p on p.id = b.user_id
order by b.created_at desc;
```

**ปิดรับสมัครสมาชิกใหม่:**
```sql
update public.app_settings set allow_signup = false;
```

**เอาใครออกจากกระดานจัดอันดับ:**
```sql
update public.profiles set show_on_leaderboard = false where username = 'someone';
```

---

## 🔒 สรุปเรื่องความปลอดภัย

- **ราคาอ่านจาก DB ฝั่ง server** เบราว์เซอร์กำหนดยอดเงินเองไม่ได้
- **webhook ไม่เชื่อ payload** — เอา charge id ไปถาม Omise ใหม่ด้วย secret key แล้วตัดสินจากคำตอบนั้น POST ปลอมจึงไม่ได้อะไร
- **ยิงซ้ำไม่มีผล** — `billing_events.charge_id` เป็น unique การ insert คือตัวคุมว่าจะต่ออายุหรือไม่
- **`extend_pro` เรียกได้เฉพาะ service_role** anon/authenticated โดนปฏิเสธ
- **ข้อมูลบัตรไม่ผ่านเซิร์ฟเวอร์เรา** — Omise.js แปลงเป็น token ในเบราว์เซอร์
- **limit บังคับใน DB** ไม่ใช่แค่ซ่อนปุ่ม ลองยิง RPC ตรงๆ ก็โดนปฏิเสธ
- helper ที่อ่านข้อมูลข้ามผู้ใช้ (`user_metrics`, `is_pro`, `plan_of`) ย้ายไป schema `app_private` ที่ PostgREST มองไม่เห็น
