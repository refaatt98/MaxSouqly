# نشر MAX — خطوة بخطوة (Supabase + Netlify)

مشروع Supabase: **Max Restaurant** (`yjytosfsktwrzsthlfji`). قاعدة البيانات فارغة حالياً — اتبع الخطوات بالترتيب.

## 1) قاعدة البيانات (مرة واحدة، دقيقة واحدة)
1. افتح Supabase → مشروعك → **SQL Editor** → **New query**.
2. انسخ محتوى الملف [`supabase/setup.sql`](supabase/setup.sql) بالكامل، الصقه، واضغط **Run**.
   - ينشئ كل الجداول والصلاحيات (RLS) والدوال والتقارير + قائمة طعام ومخزون ووصفات جاهزة (يمكنك تعديلها أو حذفها من التطبيق).
   - لا يحتوي على طلبات أو مستخدمين وهميين.

## 2) حساب المالك (أنت)
1. Supabase → **Authentication → Users → Add user → Create new user**.
2. البريد: `refaat@gmail.com` · كلمة مرور من اختيارك · فعّل **Auto Confirm User**.
3. **أول مستخدم يُنشأ يصبح المالك تلقائياً** (مع ملف موظف). رقم الهاتف تضيفه لاحقاً من شاشة الموظفين ← تعديل.

## 3) إعدادات تسجيل الدخول في Supabase
- **Authentication → Sign In / Providers → Email**: أوقف **Allow new users to sign up** (الحسابات تُنشأ فقط من داخل التطبيق).
- **Authentication → URL Configuration → Site URL**: ضع رابط موقعك على Netlify (بعد الخطوة 4).

## 4) Netlify
1. ادفع المستودع إلى GitHub (موجود: `refaatt98/MaxSouqly`، ادمج الفرع `claude/vibrant-shannon-3xw2ji` في `main`).
2. Netlify → **Add new site → Import an existing project → GitHub** → اختر المستودع.
3. الإعدادات تُقرأ تلقائياً من `netlify.toml` (أمر البناء `npm run build`، مجلد النشر `dist`، رابط Supabase والمفتاح العام موجودان فيه). اضغط **Deploy**.

## 5) الدخول السريع بالرمز (PIN) — اختياري
يحتاج دالة Edge واحدة. من جهازك:
```bash
npx supabase login
npx supabase functions deploy pin-login --no-verify-jwt --project-ref yjytosfsktwrzsthlfji
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR-SITE.netlify.app --project-ref yjytosfsktwrzsthlfji
```
أو من لوحة Supabase: **Edge Functions → Deploy a new function → Via Editor**، الاسم `pin-login`، الصق [`supabase/functions/pin-login/index.ts`](supabase/functions/pin-login/index.ts)، وأوقف **Verify JWT**.
بدون هذه الخطوة يعمل كل شيء بالبريد وكلمة المرور.

## 6) إنشاء حسابات الموظفين (من التطبيق)
سجّل الدخول كمالك ← **الموظفين** ← **+ إضافة مستخدم** (أو تبويب **الصلاحيات**): الاسم، البريد، كلمة مرور، الدور (مالك / مدير / كاشير / مطبخ / مسؤول مخزون)، الهاتف، ورمز PIN اختياري.
من تبويب الصلاحيات يمكنك أيضاً تغيير الدور، تعطيل الحساب، أو تغيير كلمة مرور أي مستخدم. كل مستخدم يغيّر كلمة مروره من **الإعدادات ← اللغة والواجهة**.

## 7) صور R2 (اختياري)
رفع الصور يتطلب Cloudflare Worker (انظر README). بدونه يعمل كل شيء وتظهر صور القائمة الجاهزة؛ فقط رفع صور جديدة يعرض رسالة "خدمة رفع الصور غير مهيأة". بعد نشر الـ Worker أضف في Netlify: `VITE_R2_WORKER_URL` و `VITE_R2_PUBLIC_URL` ثم أعد النشر.

---

# Deploying MAX (English summary)
1. Supabase → SQL Editor → paste `supabase/setup.sql` → Run (empty project only).
2. Authentication → Users → Add user `refaat@gmail.com` (auto-confirm). The first user becomes the **owner** automatically.
3. Disable public sign-ups; set Site URL to your Netlify URL.
4. Netlify → Import from GitHub → deploy (all settings in `netlify.toml`).
5. Optional PIN login: `npx supabase functions deploy pin-login --no-verify-jwt --project-ref yjytosfsktwrzsthlfji`.
6. Create staff accounts in the app: Employees → **+ إضافة مستخدم** (any role), reset passwords from the Permissions tab.
7. Optional R2 uploads: deploy `/worker`, then set `VITE_R2_WORKER_URL` / `VITE_R2_PUBLIC_URL` in Netlify.

`supabase/setup.sql` is generated from the migrations: `npm run db:setup-sql`.
