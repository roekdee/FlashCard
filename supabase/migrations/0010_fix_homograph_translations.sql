-- ============================================================
-- The spreadsheet's homograph markers leaked into the Thai column as well as
-- the English one ("นำ1", "แหวน2"), and where a word had been split into two
-- senses the gloss was simply copied from the other entry — so several rows
-- were teaching the wrong meaning outright:
--   live (v.)  was "ไลฟ์"     — a transliteration, not a meaning
--   lie  (v.)  was "โกหก"     — that is the noun sense; the A1 verb is to recline
--   last (v.)  was "สุดท้าย"  — that is the adjective; the verb means to go on
-- Fourteen rows, each set by hand against the Oxford sense.
-- ============================================================
update public.words as w set translation = v.tr
from (values
  ('50dbadc6-9f6d-4f1d-8bc7-29f618d5ff54'::uuid, 'เนื้อหา / สิ่งที่บรรจุอยู่ข้างใน'),  -- content n.
  ('64ea0608-03dd-4a50-b19b-6e4a92648f14'::uuid, 'สุดท้าย / ล่าสุด'),                  -- last (final) n.
  ('d02c5945-a5ec-4262-913b-31b5efa45fd9'::uuid, 'กินเวลา / คงอยู่นาน'),               -- last (taking time) v.
  ('b4d735bf-a8cf-433d-bec8-8a4db8ae72e6'::uuid, 'การนำ / ตำแหน่งผู้นำ'),               -- lead n.
  ('376155d2-1856-4831-9ab3-d48a11a2cefc'::uuid, 'นอนราบ / วางอยู่ในแนวนอน'),           -- lie v.
  ('465eaf53-a93f-47db-9980-5bf5ebfe2ff7'::uuid, 'คำโกหก / คำเท็จ'),                    -- lie (tell a lie) n.
  ('3f3b9b85-9836-49d2-b913-b84f6f8aab29'::uuid, 'อาศัยอยู่ / มีชีวิตอยู่'),              -- live v.
  ('52e395f4-1c8f-4a88-a42f-437f1d3b758d'::uuid, 'สด (ถ่ายทอดสด ไม่ได้บันทึกไว้)'),      -- live adv.
  ('d78bcf14-43ad-4793-8383-2d7d2bd06da5'::uuid, 'นาน / เป็นเวลานาน'),                  -- long adv.
  ('2e7fb508-fea5-4ccd-96e9-430da35804b8'::uuid, 'เงินบำนาญ'),                          -- pension n.
  ('cc34147d-3d72-4882-a17f-d01537335cc8'::uuid, 'ข้อดี / จุดแข็ง'),                     -- plus n.
  ('ab0185f0-ef43-45da-902f-68d5e1b4b0ad'::uuid, 'ปฏิเสธ / ไม่ยอมทำ'),                   -- refuse v.
  ('aa4a7c25-9d6c-4ceb-bf8d-0031b313a975'::uuid, 'แหวน / วงแหวน'),                      -- ring n. (A2)
  ('6c9f85ee-4956-4f6a-8b81-fca26babe82f'::uuid, 'เสียงกริ่ง / การโทรศัพท์')             -- ring n. (B1)
) as v(id, tr)
where w.id = v.id;
