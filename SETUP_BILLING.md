# ⚙️ ของที่ต่อไว้แล้ว และปุ่มที่ใช้แก้

ทุกอย่างในนี้ **ต่อเสร็จและทดสอบแล้ว** ไฟล์นี้บอกว่าอะไรอยู่ตรงไหน เผื่อต้องแก้หรือย้ายทีหลัง

> ⚠️ อย่าส่งคีย์ลับ (`skey_…`, service_role, client secret, API key) มาในแชต — ใส่ในหน้าเว็บของผู้ให้บริการโดยตรง

---

## 💳 รับเงิน — PromptPay ตรงเข้าบัญชี

ไม่มีเกตเวย์คั่น ไม่มีค่าธรรมเนียม เงินเข้าบัญชีทันที

**QR** สร้างในเบราว์เซอร์จาก [`promptpay.js`](promptpay.js) ตามมาตรฐาน EMVCo — ไม่ได้เรียก API ของใคร

**การไหลของเงิน**

1. `start_promptpay(plan)` จดไว้ก่อนว่าใครจะจ่ายเท่าไหร่ — ราคามาจาก `billing_plans` ไม่ใช่จากเบราว์เซอร์
2. ผู้ใช้สแกนจ่าย แล้วแนบรูปสลิป
3. Edge Function `verify-slip` เก็บสลิปลง Storage → ส่งให้ NearbyShop ตรวจ → ผ่านครบ 3 ด่านจึงเปิด Pro

**3 ด่านที่ตรวจฝั่งเรา ไม่เชื่อ API ปลายทาง**

| | |
|---|---|
| ยอดเงิน | ต้องเท่ากับที่จดไว้ใน intent เป๊ะ |
| บัญชีผู้รับ | 4 ตัวท้ายต้องตรงกับ `app_settings.promptpay_id` |
| สลิปซ้ำ | unique index บน `slip_ref` — ยิงซ้ำ insert พัง |

**เปลี่ยนเบอร์รับเงิน**
```sql
update public.app_settings set promptpay_id = '08xxxxxxxx';
```

**ปิดรับเงินชั่วคราว**
```sql
update public.app_settings set promptpay_live = false;
```

---

## 🧾 ตรวจสลิปอัตโนมัติ — NearbyShop

- API Key: https://nearbyshop.xyz/developer
- เอกสาร: https://docs.nearbyshop.xyz/slip-verify.html
- เก็บไว้ที่ Supabase → Edge Functions → Secrets ชื่อ **`SLIP_VERIFY_TOKEN`**

**เปลี่ยนไปใช้เจ้าอื่น** (EasySlip, SlipOK) ไม่ต้องแก้โค้ด — เพิ่ม secret `SLIP_VERIFY_URL` ชี้ endpoint ใหม่ แล้วเปลี่ยน `SLIP_VERIFY_TOKEN`
ถ้ารูปแบบคำตอบต่างออกไป แก้แค่ `slipRef()` กับ `amountSatang()` ใน [`supabase/functions/verify-slip/index.ts`](supabase/functions/verify-slip/index.ts)

**ถ้าไม่มี token หรือ API ล่ม** ระบบไม่เปิด Pro ให้ — ขึ้น "รอตรวจสอบ" แล้วเข้าคิวให้เจ้าของกดเอง

---

## 🛠️ คิวอนุมัติของเจ้าของ

แท็บ ✨ Pro จะมีกล่อง **สลิปรอตรวจสอบ** โผล่เฉพาะบัญชีเจ้าของ — ดูสลิป / อนุมัติ / ปฏิเสธ

ลิงก์ดูสลิปเป็น signed URL อายุ 10 นาที · bucket `slips` เป็น private

**เปลี่ยนว่าใครเป็นเจ้าของ**
```sql
update public.app_settings
   set owner_id = (select id from auth.users where email = 'someone@example.com');
```

**ทำมือจาก SQL ถ้าจำเป็น**
```sql
select i.id, u.email, i.amount_satang/100 as baht, i.months, i.created_at
from public.payment_intents i join auth.users u on u.id = i.user_id
where i.status = 'pending' order by i.created_at desc;

select public.settle_promptpay('<id>', 'manual-<เลขอ้างอิงในสลิป>', null, 'ตรวจด้วยตาแล้ว');
```

---

## 📧 อีเมล — Brevo

`smtp-relay.brevo.com` : 587 · username `b9bdae001@smtp-brevo.com` · sender `richyrock555@gmail.com`
**300 ฉบับ/วัน ฟรีถาวร** (ของ Supabase เองล็อกไว้ 2/ชม.)

ใช้กับ "ลืมรหัสผ่าน" เป็นหลัก — **การสมัครสมาชิกไม่ต้องยืนยันอีเมลแล้ว** (Confirm email ปิดอยู่)

⚠️ ส่งจาก `@gmail.com` ที่ไม่มี DKIM ของโดเมนตัวเอง Gmail มักลง Promotions/Spam — แก้ถาวรต้องมีโดเมนแล้วยืนยันใน Brevo

---

## 🔑 เข้าสู่ระบบด้วยแพลตฟอร์มอื่น

| | สถานะ |
|---|---|
| Google | ✅ In production — ใครก็ใช้ได้ |
| GitHub | ✅ |
| Discord | ✅ |
| Facebook | ยังไม่ได้ทำ — ต้องสมัคร developers.facebook.com |

**เปิด/ปิดปุ่ม** — ปุ่มจะไม่โผล่ถ้าไม่ได้ใส่ชื่อไว้ เพราะปุ่มที่ provider ยังไม่เปิดจะพาไปเจอหน้า error ดิบ
```sql
update public.app_settings set oauth_providers = array['google','github','discord'];
```

ชื่อที่รองรับ: `google` `facebook` `apple` `github` `discord` `azure` `line` `kakao` `twitter` `linkedin_oidc`
เพิ่มเจ้าใหม่ = ตั้งค่าที่ Supabase → Providers แล้วใส่ชื่อในอาร์เรย์ ไม่ต้องแก้โค้ด

redirect URI ที่ทุกเจ้าใช้: `https://xixvrekqkikxrzrinjko.supabase.co/auth/v1/callback`

---

## 📋 Free / Pro

| | Free | Pro |
|---|---|---|
| คลังคำ | A1–A2 (1,496 คำ) | ครบ 3,015 คำ |
| คำใหม่ต่อวัน | 10 | ไม่จำกัด |
| โหมดเรียน | พลิกการ์ด | + เลือก 4 ตัวเลือก, พิมพ์คำตอบ |
| สถิติ | ตัวเลขพื้นฐาน | + heatmap 1 ปี, forecast 7 วัน, วันต่อเนื่อง |
| กระดานจัดอันดับ | ❌ | ✅ |

**แก้ราคา**
```sql
update public.billing_plans set amount_satang = 12900 where code = 'pro_1m';
```

**แก้ว่า Free ได้อะไร**
```sql
update public.plan_limits
   set new_per_day_cap = 15, levels = array['A1','A2','B1']
 where plan = 'free';
```

**แถม Pro ให้ใครสักคน**
```sql
select public.extend_pro(
  (select id from public.profiles where username = 'someone'), 3);
```

**ปิดรับสมัครสมาชิกใหม่**
```sql
update public.app_settings set allow_signup = false;
```

---

## 🚀 ขึ้นเว็บ

```bash
./build.sh
```
แล้วลาก `flashcard-site.zip` ไปวางที่ Netlify → Deploys

ยังไม่ได้ต่อ GitHub auto-deploy — ต่อได้ที่ Project configuration → Build & deploy → Link repository แล้วจะ deploy เองทุกครั้งที่ push

---

## 🔒 สรุปเรื่องความปลอดภัย

- **ราคาอ่านจาก DB ฝั่ง server** เบราว์เซอร์กำหนดยอดเงินเองไม่ได้
- **`settle_promptpay` / `extend_pro` / `reject_promptpay` เรียกได้เฉพาะ service_role** — `revoke ... from public` ไม่พอ ต้อง revoke จาก `anon` และ `authenticated` ระบุชื่อ เพราะ Supabase แจก EXECUTE ให้สองตัวนี้ผ่าน default privileges (เคยหลุดจริง ผู้ใช้ธรรมดากดเปิด Pro ให้ตัวเองได้)
- **สลิปใช้ซ้ำไม่ได้** — unique index เป็นตัวบังคับ ไม่ใช่ if ในโค้ด
- **ข้อมูลบัตรไม่ผ่านเซิร์ฟเวอร์เรา** (ทางบัตรของ Omise ยังไม่ได้เปิดใช้)
- **limit บังคับใน DB** ไม่ใช่แค่ซ่อนปุ่ม ยิง RPC ตรงๆ ก็โดนปฏิเสธ
- helper ที่อ่านข้ามผู้ใช้ (`user_metrics`, `is_pro`, `plan_of`, `is_owner`) อยู่ schema `app_private` ที่ PostgREST มองไม่เห็น
- bucket `slips` เป็น private — มีเฉพาะเจ้าของที่ sign URL ได้
