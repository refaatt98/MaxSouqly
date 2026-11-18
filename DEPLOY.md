# MAX — حالة النشر / Deployment status

## ✅ تم إعداده بالكامل (Supabase: `yjytosfsktwrzsthlfji`)
- قاعدة البيانات: كل الجداول + صلاحيات RLS + الدوال + التقارير + التحديث المباشر (Realtime) لكل الشاشات.
- قائمة جاهزة: 6 أقسام، 33 منتجاً، 23 مادة خام بوصفات و3 موردين — كلها قابلة للتعديل من التطبيق.
- حساب المالك: أُنشئ عند الإعداد (البيانات ليست في المستودع).
- دوال Edge: `images` (رفع الصور إلى Cloudflare R2) و `pin-login` (الدخول السريع بالرمز).
- مفاتيح R2 محفوظة كأسرار في Supabase فقط (ليست في الكود). الصور تُعرض من `https://pub-1400032e0dba4fcbac4eb18a30180e40.r2.dev`.
- سياسة CORS على الـ bucket `max`: كل المصادر وكل الطرق (GET, HEAD, PUT, POST, DELETE).
- التسجيل العام مغلق — الحسابات تُنشأ من داخل التطبيق فقط.

## 🚀 Netlify (الخطوة الوحيدة المتبقية)
1. Netlify → **Add new site → Import an existing project → GitHub** → `refaatt98/MaxSouqly`.
2. اختر الفرع (`main` بعد الدمج، أو `claude/vibrant-shannon-3xw2ji`).
3. اضغط **Deploy** — لا حاجة لأي متغيرات بيئة؛ كل شيء في `netlify.toml` والكود.

## الاستخدام
- **المنتجات والأقسام والصور والأسعار:** القائمة ← إضافة/تعديل صنف أو قسم، ارفع الصورة واضغط حفظ. تظهر فوراً في الكاشير بدون تحديث الصفحة.
- **حسابات الموظفين (كل الأدوار):** الموظفين ← + إضافة مستخدم.
- **تغيير كلمة المرور:** الإعدادات ← اللغة والواجهة.

## Re-deploying backend changes (developers)
`npm run db:setup-sql` regenerates `supabase/setup.sql` (fresh projects). For an existing project apply only new files in `supabase/migrations/`.
Functions: `npx supabase functions deploy images --no-verify-jwt` and `pin-login --no-verify-jwt` (project ref `yjytosfsktwrzsthlfji`).
R2 secrets used by `images`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.
