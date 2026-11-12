-- =====================================================================
-- MAX demo seed — realistic data so every screen is alive on first run.
-- Demo password for all accounts: Max@12345
-- =====================================================================
select setseed(0.42);

-- ---------------------------------------------------------------------
-- Auth users (+ identities) — profiles are created by the trigger
-- ---------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'owner@max.demo',     'سامر حداد',   'owner',     'ar'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'manager@max.demo',   'ليلى منصور',  'manager',   'ar'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'cashier@max.demo',   'محمد سعيد',   'cashier',   'ar'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'kitchen@max.demo',   'رامي خليل',   'kitchen',   'ar'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'inventory@max.demo', 'نور الهدى',   'inventory', 'ar'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'cashier2@max.demo',  'يوسف عمر',    'cashier',   'he')
    ) as t(id, email, full_name, role, lang)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Max@12345', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', u.role, 'full_name', u.full_name, 'language', u.lang),
      jsonb_build_object('full_name', u.full_name), now() - interval '120 days', now(),
      '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end;
$$;

-- PINs for tablet quick-login
update public.profiles set pin_hash = extensions.crypt('1111', extensions.gen_salt('bf', 8)) where id = '00000000-0000-4000-a000-000000000003';
update public.profiles set pin_hash = extensions.crypt('2222', extensions.gen_salt('bf', 8)) where id = '00000000-0000-4000-a000-000000000004';
update public.profiles set pin_hash = extensions.crypt('3333', extensions.gen_salt('bf', 8)) where id = '00000000-0000-4000-a000-000000000005';
update public.profiles set pin_hash = extensions.crypt('4444', extensions.gen_salt('bf', 8)) where id = '00000000-0000-4000-a000-000000000006';
update public.profiles set last_login_at = now() - (random() * interval '30 hours');

-- ---------------------------------------------------------------------
-- Restaurant settings
-- ---------------------------------------------------------------------
update public.restaurant_settings set
  name = 'MAX',
  slogan = 'Good Food Good Mood',
  phone = '02-123-4567',
  address = 'شارع الإرسال، رام الله',
  vat_percent = 17,
  receipt_header = 'أهلاً وسهلاً بكم في MAX',
  receipt_footer = 'Good Food Good Mood',
  table_count = 20,
  seating_capacity = 64;

-- ---------------------------------------------------------------------
-- Categories & menu
-- ---------------------------------------------------------------------
insert into public.categories (name_ar, name_he, icon, sort_order) values
  ('برجر', 'המבורגרים', 'burger', 1),
  ('بيتزا', 'פיצות', 'pizza', 2),
  ('مشاوي', 'גריל', 'flame', 3),
  ('مشروبات', 'משקאות', 'drink', 4),
  ('حلويات', 'קינוחים', 'dessert', 5),
  ('أخرى', 'תוספות', 'fries', 6);

insert into public.menu_items (category_id, name_ar, name_he, description, price, image_url, sort_order, barcode)
select c.id, m.name_ar, m.name_he, m.descr, m.price, '/images/menu/' || m.img || '.svg', m.sort, m.barcode
from (values
  ('برجر', 'برجر كلاسيك', 'המבורגר קלאסי', 'لحم بقري طازج 150غ، خس، طماطم، بصل وصوص ماكس', 42, 'burger-classic', 1, '7290001'),
  ('برجر', 'برجر ماكس', 'המבורגר מקס', 'برجر التوقيع: 200غ لحم، شيدر مذاب وصوص ماكس السري', 58, 'burger-max', 2, '7290002'),
  ('برجر', 'برجر دجاج', 'המבורגר עוף', 'صدر دجاج مقرمش مع خس وصوص', 39, 'burger-chicken', 3, '7290003'),
  ('برجر', 'برجر بالجبن', 'צ''יזבורגר', 'لحم بقري مع شريحتين شيدر', 46, 'burger-cheese', 4, '7290004'),
  ('برجر', 'برجر مكسيكي', 'המבורגר מקסיקני', 'هالبينو، شيدر وصلصة طماطم حارة', 52, 'burger-mexican', 5, '7290005'),
  ('برجر', 'برجر حار', 'המבורגר חריף', 'لحم بقري مع فلفل حار وصوص ناري', 48, 'burger-spicy', 6, '7290006'),
  ('برجر', 'برجر مزدوج', 'המבורגר כפול', 'قطعتا لحم 300غ مع جبنة شيدر', 68, 'burger-double', 7, '7290007'),
  ('برجر', 'برجر عائلي', 'מגש משפחתי', '4 برجر مع بطاطا كبيرة وصوصات', 119, 'burger-family', 8, '7290008'),
  ('بيتزا', 'بيتزا مارغريتا', 'פיצה מרגריטה', 'صلصة طماطم وموتزاريلا وريحان', 45, 'pizza-margherita', 1, '7290101'),
  ('بيتزا', 'بيتزا ببروني', 'פיצה פפרוני', 'ببروني بقري مع موتزاريلا', 55, 'pizza-pepperoni', 2, '7290102'),
  ('بيتزا', 'بيتزا خضار', 'פיצה ירקות', 'طماطم، بصل، فلفل وزيتون', 49, 'pizza-veggie', 3, '7290103'),
  ('بيتزا', 'بيتزا دجاج باربكيو', 'פיצה עוף ברביקיו', 'دجاج مشوي مع صوص باربكيو', 58, 'pizza-bbq', 4, '7290104'),
  ('بيتزا', 'بيتزا أربع أجبان', 'פיצה ארבע גבינות', 'موتزاريلا، شيدر، بارميزان وجبنة زرقاء', 59, 'pizza-cheese', 5, '7290105'),
  ('مشاوي', 'كباب لحم', 'קבב בקר', 'سيخان كباب مع خبز وسلطة', 62, 'grill-kebab', 1, '7290201'),
  ('مشاوي', 'شيش طاووق', 'שישליק עוף', 'دجاج متبل على الفحم', 54, 'grill-tawook', 2, '7290202'),
  ('مشاوي', 'مشاوي مشكلة', 'מעורב גריל', 'كباب وطاووق وكفتة لشخصين', 89, 'grill-mixed', 3, '7290203'),
  ('مشاوي', 'كفتة بالطحينة', 'קבב בטחינה', 'كفتة مشوية بالفرن مع طحينة', 56, 'grill-kofta', 4, '7290204'),
  ('مشاوي', 'أجنحة دجاج مشوية', 'כנפיים על האש', '10 قطع مع صوص حار', 44, 'grill-wings', 5, '7290205'),
  ('مشروبات', 'كولا', 'קולה', 'علبة 330 مل', 9, 'drink-cola', 1, '7290301'),
  ('مشروبات', 'عصير برتقال طبيعي', 'מיץ תפוזים סחוט', 'برتقال معصور طازج', 14, 'drink-orange', 2, '7290302'),
  ('مشروبات', 'مياه معدنية', 'מים מינרליים', 'عبوة 500 مل', 5, 'drink-water', 3, '7290303'),
  ('مشروبات', 'قهوة عربية', 'קפה', 'قهوة بالهيل', 10, 'drink-coffee', 4, '7290304'),
  ('مشروبات', 'كابتشينو', 'קפוצ''ינו', 'إسبريسو مع حليب مرغّى', 14, 'drink-cappuccino', 5, '7290305'),
  ('مشروبات', 'ميلك شيك', 'מילקשייק', 'فانيلا أو شوكولاتة', 19, 'drink-milkshake', 6, '7290306'),
  ('حلويات', 'كنافة نابلسية', 'כנאפה', 'كنافة بالجبنة ساخنة', 22, 'dessert-kunafa', 1, '7290401'),
  ('حلويات', 'آيس كريم', 'גלידה', 'ثلاث كرات بنكهات مختلفة', 15, 'dessert-icecream', 2, '7290402'),
  ('حلويات', 'كيك شوكولاتة', 'עוגת שוקולד', 'قطعة كيك غنية بالشوكولاتة', 19, 'dessert-cake', 3, '7290403'),
  ('حلويات', 'بان كيك', 'פנקייק', 'مع عسل وفواكه', 21, 'dessert-pancake', 4, '7290404'),
  ('أخرى', 'بطاطا مقلية', 'צ''יפס', 'بطاطا ذهبية مقرمشة', 15, 'side-fries', 1, '7290501'),
  ('أخرى', 'بطاطا بالجبن', 'צ''יפס גבינה', 'بطاطا مع صوص الشيدر', 22, 'side-cheese-fries', 2, '7290502'),
  ('أخرى', 'حلقات بصل', 'טבעות בצל', '8 حلقات مقرمشة', 17, 'side-onion-rings', 3, '7290503'),
  ('أخرى', 'سلطة ماكس', 'סלט מקס', 'خضار موسمية مع صوص الليمون', 24, 'side-salad', 4, '7290504'),
  ('أخرى', 'ناجتس دجاج', 'נאגטס עוף', '8 قطع مع صوص', 26, 'side-nuggets', 5, '7290505')
) as m(cat, name_ar, name_he, descr, price, img, sort, barcode)
join public.categories c on c.name_ar = m.cat;

-- ---------------------------------------------------------------------
-- Suppliers & ingredients (quantities set at the end, after history)
-- ---------------------------------------------------------------------
insert into public.suppliers (name, contact_name, phone, email, address, notes) values
  ('ملحمة الأمانة', 'أبو خالد', '0599-111-222', 'amana@example.com', 'البيرة', 'توريد يومي للحوم والدجاج'),
  ('مخابز الريف', 'سامي', '0598-333-444', 'reef@example.com', 'رام الله', 'خبز البرجر وعجينة البيتزا'),
  ('شركة الوادي للتوزيع', 'منى', '0597-555-666', 'wadi@example.com', 'نابلس', 'مشروبات، ألبان وخضار');

create temporary table seed_ing (name_ar text, name_he text, unit public.unit_type, target numeric, min_q numeric, cost numeric, supplier text);
insert into seed_ing values
  ('لحم بقري', 'בשר בקר', 'kg', 50, 15, 55, 'ملحمة الأمانة'),
  ('صدر دجاج', 'חזה עוף', 'kg', 30, 10, 28, 'ملحمة الأمانة'),
  ('كفتة لحم', 'קבב טחון', 'kg', 12, 4, 50, 'ملحمة الأمانة'),
  ('خبز برجر', 'לחמניות המבורגר', 'piece', 200, 60, 1.2, 'مخابز الريف'),
  ('عجينة بيتزا', 'בצק פיצה', 'piece', 60, 20, 3, 'مخابز الريف'),
  ('بطاطا', 'תפוחי אדמה', 'kg', 8, 15, 4, 'شركة الوادي للتوزيع'),
  ('كولا', 'קולה', 'carton', 50, 10, 48, 'شركة الوادي للتوزيع'),
  ('مياه معدنية', 'מים מינרליים', 'carton', 30, 8, 24, 'شركة الوادي للتوزيع'),
  ('جبنة شيدر', 'גבינת צ''דר', 'kg', 4, 5, 48, 'شركة الوادي للتوزيع'),
  ('جبنة موتزاريلا', 'מוצרלה', 'kg', 9, 4, 42, 'شركة الوادي للتوزيع'),
  ('ببروني', 'פפרוני', 'kg', 3, 1.5, 70, 'ملحمة الأمانة'),
  ('خس', 'חסה', 'kg', 6, 2, 8, 'شركة الوادي للتوزيع'),
  ('طماطم', 'עגבניות', 'kg', 12, 4, 6, 'شركة الوادي للتوزيع'),
  ('بصل', 'בצל', 'kg', 15, 4, 4, 'شركة الوادي للتوزيع'),
  ('فلفل حار', 'פלפל חריף', 'kg', 2, 0.5, 15, 'شركة الوادي للتوزيع'),
  ('صلصة طماطم', 'רוטב עגבניות', 'l', 10, 3, 12, 'شركة الوادي للتوزيع'),
  ('صوص ماكس', 'רוטב מקס', 'l', 6, 2, 30, 'شركة الوادي للتوزيع'),
  ('زيت قلي', 'שמן טיגון', 'l', 40, 10, 9, 'شركة الوادي للتوزيع'),
  ('عصير برتقال', 'מיץ תפוזים', 'l', 20, 5, 10, 'شركة الوادي للتوزيع'),
  ('بن قهوة', 'פולי קפה', 'kg', 5, 1, 90, 'شركة الوادي للتوزيع'),
  ('حليب', 'חלב', 'l', 18, 6, 6, 'شركة الوادي للتوزيع'),
  ('آيس كريم', 'גלידה', 'l', 10, 3, 25, 'شركة الوادي للتوزيع'),
  ('كنافة', 'כנאפה', 'kg', 5, 2, 35, 'مخابز الريف');

insert into public.ingredients (name_ar, name_he, unit, quantity, min_quantity, cost_per_unit, supplier_id)
select s.name_ar, s.name_he, s.unit, 0, s.min_q, s.cost, sp.id
from seed_ing s join public.suppliers sp on sp.name = s.supplier;

-- ---------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------
insert into public.recipe_items (menu_item_id, ingredient_id, quantity, unit)
select m.id, i.id, r.qty, r.unit::public.unit_type
from (values
  ('برجر كلاسيك', 'لحم بقري', 150, 'g'), ('برجر كلاسيك', 'خبز برجر', 1, 'piece'), ('برجر كلاسيك', 'خس', 20, 'g'),
  ('برجر كلاسيك', 'طماطم', 30, 'g'), ('برجر كلاسيك', 'بصل', 15, 'g'), ('برجر كلاسيك', 'صوص ماكس', 20, 'ml'),
  ('برجر ماكس', 'لحم بقري', 200, 'g'), ('برجر ماكس', 'خبز برجر', 1, 'piece'), ('برجر ماكس', 'جبنة شيدر', 30, 'g'),
  ('برجر ماكس', 'خس', 20, 'g'), ('برجر ماكس', 'طماطم', 30, 'g'), ('برجر ماكس', 'صوص ماكس', 30, 'ml'),
  ('برجر دجاج', 'صدر دجاج', 150, 'g'), ('برجر دجاج', 'خبز برجر', 1, 'piece'), ('برجر دجاج', 'خس', 20, 'g'),
  ('برجر دجاج', 'صوص ماكس', 20, 'ml'), ('برجر دجاج', 'زيت قلي', 30, 'ml'),
  ('برجر بالجبن', 'لحم بقري', 150, 'g'), ('برجر بالجبن', 'خبز برجر', 1, 'piece'), ('برجر بالجبن', 'جبنة شيدر', 40, 'g'), ('برجر بالجبن', 'بصل', 15, 'g'),
  ('برجر مكسيكي', 'لحم بقري', 150, 'g'), ('برجر مكسيكي', 'خبز برجر', 1, 'piece'), ('برجر مكسيكي', 'جبنة شيدر', 20, 'g'),
  ('برجر مكسيكي', 'فلفل حار', 20, 'g'), ('برجر مكسيكي', 'طماطم', 30, 'g'),
  ('برجر حار', 'لحم بقري', 150, 'g'), ('برجر حار', 'خبز برجر', 1, 'piece'), ('برجر حار', 'فلفل حار', 30, 'g'), ('برجر حار', 'صوص ماكس', 20, 'ml'),
  ('برجر مزدوج', 'لحم بقري', 300, 'g'), ('برجر مزدوج', 'خبز برجر', 1, 'piece'), ('برجر مزدوج', 'جبنة شيدر', 40, 'g'), ('برجر مزدوج', 'خس', 20, 'g'),
  ('برجر عائلي', 'لحم بقري', 600, 'g'), ('برجر عائلي', 'خبز برجر', 4, 'piece'), ('برجر عائلي', 'جبنة شيدر', 80, 'g'),
  ('برجر عائلي', 'خس', 60, 'g'), ('برجر عائلي', 'طماطم', 100, 'g'), ('برجر عائلي', 'بطاطا', 500, 'g'), ('برجر عائلي', 'زيت قلي', 100, 'ml'),
  ('بيتزا مارغريتا', 'عجينة بيتزا', 1, 'piece'), ('بيتزا مارغريتا', 'صلصة طماطم', 100, 'ml'), ('بيتزا مارغريتا', 'جبنة موتزاريلا', 150, 'g'),
  ('بيتزا ببروني', 'عجينة بيتزا', 1, 'piece'), ('بيتزا ببروني', 'صلصة طماطم', 100, 'ml'), ('بيتزا ببروني', 'جبنة موتزاريلا', 150, 'g'), ('بيتزا ببروني', 'ببروني', 60, 'g'),
  ('بيتزا خضار', 'عجينة بيتزا', 1, 'piece'), ('بيتزا خضار', 'صلصة طماطم', 100, 'ml'), ('بيتزا خضار', 'جبنة موتزاريلا', 120, 'g'),
  ('بيتزا خضار', 'طماطم', 60, 'g'), ('بيتزا خضار', 'بصل', 40, 'g'),
  ('بيتزا دجاج باربكيو', 'عجينة بيتزا', 1, 'piece'), ('بيتزا دجاج باربكيو', 'جبنة موتزاريلا', 130, 'g'), ('بيتزا دجاج باربكيو', 'صدر دجاج', 120, 'g'),
  ('بيتزا أربع أجبان', 'عجينة بيتزا', 1, 'piece'), ('بيتزا أربع أجبان', 'جبنة موتزاريلا', 200, 'g'), ('بيتزا أربع أجبان', 'جبنة شيدر', 60, 'g'),
  ('كباب لحم', 'كفتة لحم', 250, 'g'), ('كباب لحم', 'بصل', 30, 'g'), ('كباب لحم', 'طماطم', 50, 'g'),
  ('شيش طاووق', 'صدر دجاج', 250, 'g'), ('شيش طاووق', 'طماطم', 40, 'g'),
  ('مشاوي مشكلة', 'كفتة لحم', 200, 'g'), ('مشاوي مشكلة', 'صدر دجاج', 200, 'g'), ('مشاوي مشكلة', 'بصل', 50, 'g'), ('مشاوي مشكلة', 'طماطم', 80, 'g'),
  ('كفتة بالطحينة', 'كفتة لحم', 250, 'g'), ('كفتة بالطحينة', 'بطاطا', 150, 'g'),
  ('أجنحة دجاج مشوية', 'صدر دجاج', 300, 'g'), ('أجنحة دجاج مشوية', 'فلفل حار', 10, 'g'),
  ('كولا', 'كولا', 0.0417, 'carton'),
  ('عصير برتقال طبيعي', 'عصير برتقال', 300, 'ml'),
  ('مياه معدنية', 'مياه معدنية', 0.0833, 'carton'),
  ('قهوة عربية', 'بن قهوة', 15, 'g'),
  ('كابتشينو', 'بن قهوة', 18, 'g'), ('كابتشينو', 'حليب', 150, 'ml'),
  ('ميلك شيك', 'آيس كريم', 150, 'ml'), ('ميلك شيك', 'حليب', 200, 'ml'),
  ('كنافة نابلسية', 'كنافة', 200, 'g'),
  ('آيس كريم', 'آيس كريم', 150, 'ml'),
  ('بان كيك', 'حليب', 100, 'ml'),
  ('بطاطا مقلية', 'بطاطا', 250, 'g'), ('بطاطا مقلية', 'زيت قلي', 50, 'ml'),
  ('بطاطا بالجبن', 'بطاطا', 250, 'g'), ('بطاطا بالجبن', 'جبنة شيدر', 40, 'g'), ('بطاطا بالجبن', 'زيت قلي', 50, 'ml'),
  ('حلقات بصل', 'بصل', 150, 'g'), ('حلقات بصل', 'زيت قلي', 50, 'ml'),
  ('سلطة ماكس', 'خس', 100, 'g'), ('سلطة ماكس', 'طماطم', 100, 'g'), ('سلطة ماكس', 'بصل', 30, 'g'),
  ('ناجتس دجاج', 'صدر دجاج', 200, 'g'), ('ناجتس دجاج', 'زيت قلي', 60, 'ml')
) as r(menu, ing, qty, unit)
join public.menu_items m on m.name_ar = r.menu
join public.ingredients i on i.name_ar = r.ing;

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
insert into public.employees_meta (profile_id, full_name, position, phone, salary_type, salary_amount, hire_date) values
  ('00000000-0000-4000-a000-000000000001', 'سامر حداد', 'المالك', '0599-000-001', 'monthly', 0, current_date - 900),
  ('00000000-0000-4000-a000-000000000002', 'ليلى منصور', 'مديرة الفرع', '0599-000-002', 'monthly', 9500, current_date - 640),
  ('00000000-0000-4000-a000-000000000003', 'محمد سعيد', 'كاشير', '0599-000-003', 'hourly', 38, current_date - 300),
  ('00000000-0000-4000-a000-000000000004', 'رامي خليل', 'رئيس المطبخ', '0599-000-004', 'monthly', 8200, current_date - 520),
  ('00000000-0000-4000-a000-000000000005', 'نور الهدى', 'مسؤولة المخزون', '0599-000-005', 'monthly', 6800, current_date - 410),
  ('00000000-0000-4000-a000-000000000006', 'يوسف عمر', 'كاشير', '0599-000-006', 'hourly', 36, current_date - 120),
  (null, 'خالد ناصر', 'طاهٍ مساعد', '0599-000-007', 'hourly', 40, current_date - 200),
  (null, 'أحمد جابر', 'سائق توصيل', '0599-000-008', 'hourly', 35, current_date - 90);

-- Weekly schedule: this week and next (Saturday-first)
insert into public.work_shifts (employee_id, shift_date, start_time, end_time)
select e.id, d::date,
  case when (row_number() over (partition by d order by e.full_name)) % 2 = 0 then time '10:00' else time '15:00' end,
  case when (row_number() over (partition by d order by e.full_name)) % 2 = 0 then time '18:00' else time '23:30' end
from public.employees_meta e
cross join generate_series(
  current_date - ((extract(dow from current_date)::integer + 1) % 7),
  current_date - ((extract(dow from current_date)::integer + 1) % 7) + 13,
  interval '1 day') d
where e.position <> 'المالك' and (extract(dow from d)::integer + hashtext(e.full_name)) % 7 <> 0;

-- Attendance for the last 30 days
insert into public.attendance (employee_id, clock_in, clock_out)
select e.id,
  ((d::date + time '10:00' + (random() * interval '25 minutes'))::timestamp at time zone 'Asia/Jerusalem'),
  ((d::date + time '18:00' + (random() * interval '50 minutes'))::timestamp at time zone 'Asia/Jerusalem')
from public.employees_meta e
cross join generate_series(current_date - 30, current_date - 1, interval '1 day') d
where e.position <> 'المالك' and random() > 0.15;
-- today: some staff are on the clock right now
insert into public.attendance (employee_id, clock_in)
select e.id, now() - (interval '2 hours' + random() * interval '2 hours')
from public.employees_meta e where e.position in ('كاشير', 'رئيس المطبخ', 'طاهٍ مساعد');

-- Previous month payroll, already paid
insert into public.payroll (employee_id, period_month, hours_worked, base_amount, bonuses, advances, deductions, status, paid_at)
select e.id, date_trunc('month', current_date - interval '1 month')::date,
  case when e.salary_type = 'hourly' then 182 else 0 end,
  case when e.salary_type = 'hourly' then 182 * e.salary_amount else e.salary_amount end,
  case when random() > 0.6 then 300 else 0 end, case when random() > 0.7 then 500 else 0 end, 0,
  'paid', date_trunc('month', current_date) + interval '2 days'
from public.employees_meta e where e.salary_amount > 0;

-- ---------------------------------------------------------------------
-- Cash shifts and 30 days of orders
-- ---------------------------------------------------------------------
create temporary table seed_orders (
  seq serial, ts timestamptz, cashier uuid, type public.order_type, table_no int, status public.order_status,
  pay text, discount boolean, customer int
);

do $$
declare
  d date;
  n integer;
  i integer;
  v_hour numeric;
  v_ts timestamptz;
  v_now timestamptz := now();
  v_dow integer;
  v_r numeric;
begin
  for d in select generate_series(current_date - 29, current_date, interval '1 day')::date loop
    v_dow := extract(dow from d)::integer;
    -- Thursday/Friday evenings are busiest
    n := 34 + floor(random() * 18)::integer + case when v_dow in (4, 5) then 18 else 0 end;
    for i in 1..n loop
      v_r := random();
      v_hour := case
        when v_r < 0.38 then 12 + random() * 3     -- lunch rush
        when v_r < 0.85 then 18 + random() * 4     -- dinner rush
        else 11 + random() * 12.5                  -- anytime
      end;
      v_ts := (d::timestamp + make_interval(secs => v_hour * 3600)) at time zone 'Asia/Jerusalem';
      continue when v_ts > v_now - interval '4 minutes';
      v_r := random();
      insert into seed_orders (ts, cashier, type, table_no, status, pay, discount, customer)
      values (
        v_ts,
        case when random() < 0.55 then '00000000-0000-4000-a000-000000000003'::uuid
             when random() < 0.85 then '00000000-0000-4000-a000-000000000006'::uuid
             else '00000000-0000-4000-a000-000000000002'::uuid end,
        case when v_r < 0.5 then 'dine_in' when v_r < 0.8 then 'takeaway' else 'delivery' end::public.order_type,
        case when v_r < 0.5 then 1 + floor(random() * 20)::integer end,
        case when random() < 0.025 then 'cancelled' else 'served' end::public.order_status,
        case when random() < 0.52 then 'cash' when random() < 0.9 then 'card' else 'mixed' end,
        random() < 0.08,
        floor(random() * 8)::integer
      );
    end loop;
  end loop;
end;
$$;

-- today's most recent orders are still in the kitchen
with recent as (
  select seq, row_number() over (order by ts desc) rn from seed_orders where ts::date >= current_date - 1
)
update seed_orders s set status = case when r.rn <= 3 then 'new' when r.rn <= 6 then 'preparing' else 'ready' end::public.order_status
from recent r where r.seq = s.seq and r.rn <= 8;

-- one shift per cashier per day; today's shift for the main cashier stays open
insert into public.cash_shifts (cashier_id, opening_float, opened_at, closed_at)
select x.cashier, 500,
  (x.day::timestamp + time '10:30') at time zone 'Asia/Jerusalem',
  case when x.day = current_date and x.cashier = '00000000-0000-4000-a000-000000000003' then null
       else (x.day::timestamp + time '23:55') at time zone 'Asia/Jerusalem' end
from (select distinct (ts at time zone 'Asia/Jerusalem')::date as day, cashier from seed_orders) x
order by x.day;

-- orders in chronological order (so order numbers increase with time)
create temporary table seed_items (seq int, menu_item_id uuid, qty int, notes text);
insert into seed_items
select s.seq, m.id, 1 + floor(random() * random() * 3)::integer,
  case when random() < 0.1 then (array['بدون بصل', 'زيادة صوص', 'بدون مخلل', 'حار جداً', 'بدون جبنة'])[1 + floor(random() * 5)::integer] else '' end
from seed_orders s
cross join lateral (
  select id from public.menu_items
  where random() < 0.16 + 0 * s.seq
  order by case when name_ar like 'برجر%' then random() * 0.6 else random() end
  limit 1 + floor(random() * 4)::integer
) m;
-- guarantee every order has at least one line
insert into seed_items
select s.seq, (select id from public.menu_items where name_ar = 'برجر كلاسيك'), 1, ''
from seed_orders s where not exists (select 1 from seed_items i where i.seq = s.seq);

do $$
declare
  o record;
  v_sub numeric;
  v_cost numeric;
  v_disc numeric;
  v_total numeric;
  v_order uuid;
  v_shift uuid;
  v_names text[] := array['أبو أحمد', 'سارة', 'محمود علي', 'رنا', 'خليل', 'هبة', 'عمر', 'دانا'];
begin
  for o in select * from seed_orders order by ts loop
    select sum(m.price * i.qty), sum(public.menu_item_cost(m.id) * i.qty) into v_sub, v_cost
    from seed_items i join public.menu_items m on m.id = i.menu_item_id where i.seq = o.seq;
    v_disc := case when o.discount then round(v_sub * 0.1, 2) else 0 end;
    v_total := v_sub - v_disc;
    select id into v_shift from public.cash_shifts
    where cashier_id = o.cashier and opened_at <= o.ts and (closed_at is null or closed_at >= o.ts)
    order by opened_at desc limit 1;

    insert into public.orders (
      client_ref, type, table_no, customer_name, customer_phone, customer_address, status, subtotal,
      discount_type, discount_value, discount_amount, total, vat_amount, cost_total, cashier_id, shift_id,
      void_reason, voided_by, voided_at, preparing_at, ready_at, served_at, created_at, updated_at
    ) values (
      gen_random_uuid(), o.type, o.table_no,
      case when o.type = 'delivery' then v_names[o.customer + 1] else '' end,
      case when o.type = 'delivery' then '059' || lpad((1000000 + floor(random() * 8999999))::text, 7, '0') else '' end,
      case when o.type = 'delivery' then 'رام الله - حي ' || (array['الطيرة', 'الماصيون', 'البالوع', 'المصايف'])[1 + o.customer % 4] else '' end,
      o.status, v_sub, case when o.discount then 'percent'::public.discount_type end, case when o.discount then 10 else 0 end,
      v_disc, v_total, round(v_total * 17 / 117, 2), round(v_cost, 2), o.cashier, v_shift,
      case when o.status = 'cancelled' then 'طلب الزبون الإلغاء' end,
      case when o.status = 'cancelled' then '00000000-0000-4000-a000-000000000002'::uuid end,
      case when o.status = 'cancelled' then o.ts + interval '3 minutes' end,
      case when o.status in ('preparing', 'ready', 'served') then o.ts + interval '1 minute' end,
      case when o.status in ('ready', 'served') then o.ts + interval '9 minutes' end,
      case when o.status = 'served' then o.ts + interval '13 minutes' end,
      o.ts, o.ts
    ) returning id into v_order;

    insert into public.order_items (order_id, menu_item_id, name_snapshot, name_he_snapshot, unit_price_snapshot,
      unit_cost_snapshot, quantity, line_total, notes, kitchen_status, created_at, updated_at)
    select v_order, m.id, m.name_ar, m.name_he, m.price, public.menu_item_cost(m.id), i.qty, m.price * i.qty, i.notes,
      case o.status when 'new' then 'new' when 'preparing' then 'preparing' when 'ready' then 'ready' else 'served' end::public.kitchen_status,
      o.ts, o.ts
    from seed_items i join public.menu_items m on m.id = i.menu_item_id where i.seq = o.seq;

    if o.pay = 'mixed' and v_total > 20 then
      insert into public.payments (order_id, method, amount, tendered, change_given, created_at) values
        (v_order, 'cash', 20, 20, 0, o.ts),
        (v_order, 'card', v_total - 20, null, 0, o.ts);
    elsif o.pay = 'card' then
      insert into public.payments (order_id, method, amount, created_at) values (v_order, 'card', v_total, o.ts);
    else
      insert into public.payments (order_id, method, amount, tendered, change_given, created_at)
      values (v_order, 'cash', v_total, ceil(v_total / 50) * 50, ceil(v_total / 50) * 50 - v_total, o.ts);
    end if;
  end loop;
end;
$$;

-- close historic shifts with realistic Z figures (small variances)
update public.cash_shifts s set
  cash_sales = x.cash, card_sales = x.card, expected_cash = s.opening_float + x.cash,
  counted_cash = s.opening_float + x.cash + (array[0, 0, 0, -5, 10, -20, 0, 2])[1 + floor(random() * 8)::integer]
from (
  select o.shift_id,
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) cash,
    coalesce(sum(p.amount) filter (where p.method = 'card'), 0) card
  from public.orders o join public.payments p on p.order_id = o.id
  where o.status not in ('cancelled', 'refunded') group by o.shift_id
) x
where x.shift_id = s.id and s.closed_at is not null;

-- ---------------------------------------------------------------------
-- Purchase orders (historic received + open ones)
-- ---------------------------------------------------------------------
do $$
declare
  w integer;
  v_po uuid;
  v_sup record;
begin
  for w in 1..4 loop
    for v_sup in select * from public.suppliers loop
      insert into public.purchase_orders (supplier_id, status, notes, created_by, sent_at, received_at, received_by, created_at)
      values (v_sup.id, 'received', 'طلبية أسبوعية', '00000000-0000-4000-a000-000000000005',
              now() - make_interval(days => 31 - w * 7), now() - make_interval(days => 30 - w * 7),
              '00000000-0000-4000-a000-000000000005', now() - make_interval(days => 31 - w * 7))
      returning id into v_po;
      insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
      -- sized from the real consumption of the following week (+15% safety)
      select v_po, i.id,
        greatest(1, ceil(1.15 * coalesce((
          select sum(ri.quantity * public.unit_factor(ri.unit, i.unit) * oi.quantity)
          from public.orders o
          join public.order_items oi on oi.order_id = o.id
          join public.recipe_items ri on ri.menu_item_id = oi.menu_item_id and ri.ingredient_id = i.id
          where o.created_at >= now() - make_interval(days => 30 - w * 7)
            and o.created_at < now() - make_interval(days => 30 - w * 7 - (case when w = 4 then 9 else 7 end))
        ), 0) + case i.unit when 'kg' then 2 when 'l' then 2 else 5 end)),
        i.cost_per_unit
      from public.ingredients i where i.supplier_id = v_sup.id;
    end loop;
  end loop;

  insert into public.purchase_orders (supplier_id, status, notes, created_by, sent_at, expected_date)
  select id, 'sent', 'طلب عاجل — بطاطا وجبنة', '00000000-0000-4000-a000-000000000005', now() - interval '5 hours', current_date + 1
  from public.suppliers where name = 'شركة الوادي للتوزيع' returning id into v_po;
  insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
  select v_po, id, case name_ar when 'بطاطا' then 40 else 10 end, cost_per_unit
  from public.ingredients where name_ar in ('بطاطا', 'جبنة شيدر');

  insert into public.purchase_orders (supplier_id, status, notes, created_by)
  select id, 'draft', 'طلبية نهاية الأسبوع', '00000000-0000-4000-a000-000000000005'
  from public.suppliers where name = 'ملحمة الأمانة' returning id into v_po;
  insert into public.purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
  select v_po, id, 20, cost_per_unit from public.ingredients where name_ar in ('لحم بقري', 'صدر دجاج');
end;
$$;

-- ---------------------------------------------------------------------
-- Stock history: opening balance + purchases − sales (+ voids) with running balances,
-- ending exactly at the target quantities.
-- ---------------------------------------------------------------------
create temporary table seed_moves (ts timestamptz, ingredient_id uuid, change numeric, reason public.stock_reason, ref uuid, note text);

insert into seed_moves
select o.created_at, ri.ingredient_id,
  -round(sum(ri.quantity * public.unit_factor(ri.unit, i.unit) * oi.quantity), 3), 'sale', o.id, '#' || o.order_number
from public.orders o
join public.order_items oi on oi.order_id = o.id
join public.recipe_items ri on ri.menu_item_id = oi.menu_item_id
join public.ingredients i on i.id = ri.ingredient_id
group by o.id, o.created_at, o.order_number, ri.ingredient_id;

insert into seed_moves
select m.ts + interval '3 minutes', m.ingredient_id, -m.change, 'void', m.ref, 'إلغاء ' || m.note
from seed_moves m join public.orders o on o.id = m.ref where o.status = 'cancelled';

insert into seed_moves
select po.received_at, poi.ingredient_id, poi.quantity, 'purchase', po.id, 'أمر شراء #' || po.po_number
from public.purchase_orders po join public.purchase_order_items poi on poi.purchase_order_id = po.id
where po.status = 'received';

-- a little waste
insert into seed_moves
select now() - make_interval(days => d), i.id, -round((0.2 + random() * 0.8)::numeric, 3), 'waste', null, 'تالف — انتهاء صلاحية'
from public.ingredients i cross join generate_series(3, 27, 8) d
where i.unit in ('kg', 'l');

-- opening balance large enough to never go negative; a stocktake variance
-- yesterday brings each item exactly to today's target quantity
with running as (
  select ingredient_id, sum(change) over (partition by ingredient_id order by ts, change desc rows unbounded preceding) as r
  from seed_moves
), stats as (
  select i.id, t.target, t.min_q,
    coalesce((select sum(change) from seed_moves m where m.ingredient_id = i.id), 0) as r_end,
    coalesce((select min(r) from running x where x.ingredient_id = i.id), 0) as r_min
  from public.ingredients i join seed_ing t on t.name_ar = i.name_ar
), opening as (
  select id, target, r_end, greatest(target - r_end, -r_min + min_q) as o from stats
)
insert into seed_moves
select now() - interval '31 days', id, o, 'adjustment'::public.stock_reason, null::uuid, 'رصيد افتتاحي' from opening
union all
select now() - interval '20 hours', id, target - (o + r_end), 'adjustment', null, 'جرد دوري: فرق عن الدفاتر'
from opening where abs(target - (o + r_end)) > 0.0005;

insert into public.stock_movements (ingredient_id, change, quantity_after, reason, ref_id, note, user_id, created_at, updated_at)
select ingredient_id, change,
  sum(change) over (partition by ingredient_id order by ts, change desc rows unbounded preceding),
  reason, ref, note,
  case when reason in ('purchase', 'adjustment', 'waste') then '00000000-0000-4000-a000-000000000005'::uuid
       when reason = 'void' then '00000000-0000-4000-a000-000000000002'::uuid end,
  ts, ts
from seed_moves;

update public.ingredients i set quantity = t.target from seed_ing t where t.name_ar = i.name_ar;

-- ---------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------
insert into public.expenses (category, amount, note, expense_date, user_id)
select 'rent'::public.expense_category, 12000::numeric, 'إيجار المحل', date_trunc('month', current_date)::date, '00000000-0000-4000-a000-000000000001'::uuid
union all
select 'rent', 12000, 'إيجار المحل', date_trunc('month', current_date - interval '1 month')::date, '00000000-0000-4000-a000-000000000001'
union all
select 'utilities', round((700 + random() * 400)::numeric, 2), 'كهرباء وماء وغاز', d::date, '00000000-0000-4000-a000-000000000002'
from generate_series(current_date - 28, current_date, interval '7 days') d
union all
select 'supplies', round((120 + random() * 260)::numeric, 2), 'مواد تغليف ومناديل', d::date, '00000000-0000-4000-a000-000000000002'
from generate_series(current_date - 27, current_date, interval '3 days') d
union all
select 'maintenance', 850, 'صيانة الشواية', current_date - 12, '00000000-0000-4000-a000-000000000002'
union all
select 'marketing', 1500, 'حملة إعلانات انستغرام', current_date - 18, '00000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
insert into public.notifications (type, title, body, ref_id, target_roles, created_at)
select 'low_stock', 'مخزون منخفض: ' || name_ar,
  'الكمية الحالية ' || trim(to_char(quantity, 'FM999990.###')) || ' — الحد الأدنى ' || trim(to_char(min_quantity, 'FM999990.###')),
  id, '{owner,manager,inventory}', now() - interval '40 minutes'
from public.ingredients where quantity <= min_quantity;

insert into public.notifications (type, title, body, ref_id, target_roles, created_at)
select 'void', 'إلغاء الطلب #' || order_number, void_reason, id, '{owner,manager}', voided_at
from public.orders where status = 'cancelled' order by voided_at desc limit 3;

insert into public.audit_log (user_id, action, entity, entity_id, details, created_at)
select voided_by, 'void_order', 'order', id,
  jsonb_build_object('order_number', order_number, 'total', total, 'reason', void_reason), voided_at
from public.orders where status = 'cancelled';
