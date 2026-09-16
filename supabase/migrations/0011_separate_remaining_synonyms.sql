-- ============================================================
-- The last seven pairs still sharing a Thai gloss after the enrichment pass.
-- They are genuine near synonyms, so each keeps its meaning and gains the
-- nuance that tells it apart — enough for get_quiz_options to stop treating
-- them as interchangeable.
--
-- Two were simply wrong: `brand` is tagged a verb but read "ยี่ห้อ", and `site`
-- had been glossed "เว็บไซต์", which is what `website` is for.
-- ============================================================
update public.words as w set translation = v.tr
from (values
  ('abbc81e7-a8b3-46b8-b785-cbdfef3c871a'::uuid, 'เฉพาะอันนั้น / รายนั้นโดยเฉพาะ'),           -- particular adj.
  ('76cbe5de-f6f0-4dce-8386-0a4be5aaad0f'::uuid, 'เฉพาะเจาะจง (ระบุชัดว่าอันไหน)'),             -- specific adj.
  ('1578e2a8-d8f2-4b83-9d03-822daaebe736'::uuid, 'โดยเฉพาะอย่างยิ่ง (เน้นว่ามากกว่าอย่างอื่น)'), -- especially adv.
  ('fe9b04f2-a3dc-4add-9305-affdc415b63a'::uuid, 'เป็นพิเศษ / มากเป็นพิเศษ'),                   -- particularly adv.
  ('d27d9450-3aca-4bb8-940d-d4098cbcf0e6'::uuid, 'บางที / อาจจะ (ภาษาพูด)'),                    -- maybe adv.
  ('df3e45b5-cd12-44b2-b5c2-fceb8decdb74'::uuid, 'บางที / อาจจะ (ทางการกว่า maybe)'),           -- perhaps adv.
  ('605c7c38-0a3d-4ee5-aff2-baa0b0edf9e9'::uuid, 'ใบอนุญาต (เช่น ใบขับขี่)'),                    -- licence n.
  ('e3631960-8a74-4717-a897-1d3eba3f4f1c'::uuid, 'ใบอนุญาต (ให้ทำสิ่งหนึ่งเป็นการเฉพาะ)'),       -- permit n.
  ('09f37377-2dd8-45de-bbda-aa9e3ef30090'::uuid, 'ตีตราสินค้า / สร้างแบรนด์'),                   -- brand v.
  ('53278357-bdb7-4720-9713-f8b163298968'::uuid, 'ยี่ห้อ / รุ่นที่ผลิต'),                         -- make n.
  ('acf0a5dc-b26d-4ada-b1c2-a1e1931d71cf'::uuid, 'สถานที่ / ที่ตั้ง'),                            -- site n.
  ('81bc88a4-71e4-4ea6-a8b6-08669309c580'::uuid, 'เว็บไซต์'),                                    -- website n.
  ('d3974367-1312-4b6c-b7a7-d964c094fc33'::uuid, 'อย่างชัดเจน (มองเห็นหรือได้ยินชัด)'),           -- clearly adv.
  ('4363f277-481a-48e9-aedb-1f3e5b29b983'::uuid, 'อย่างเห็นได้ชัด / เห็นๆ อยู่')                  -- obviously adv.
) as v(id, tr)
where w.id = v.id;
