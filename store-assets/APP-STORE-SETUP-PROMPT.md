Set up my iOS app "MAX Management" in App Store Connect using the browser. I'm signed in to my Apple developer account. Stop and ask me whenever Apple asks for a two-factor code, a password, or a payment/legal agreement, and never type or paste secret keys into any chat.

Facts:
- Bundle ID: com.souqly.maxmanagement (explicit App ID, no extra capabilities)
- App name: MAX Management (if taken: "MAX Management – Restaurant")
- Primary language: Arabic · SKU: MAXMGMT001 · Category: Business · Price: Free
- Privacy policy URL: https://maxsouqly.netlify.app/privacy.html
- Support URL: https://maxsouqly.netlify.app/support.html · Marketing URL: https://maxsouqly.netlify.app
- Demo account for App Review: demo@maxsouqly.app / (password: ask me) (owner access, sign in with "Email & password")
- Screenshots: AppStore-Screenshots.zip in my Downloads (iphone-*.png = 6.9" 1290×2796, ipad-*.png = 13" 2064×2752)
- The app icon is inside the build; App Store Connect takes it from the upload, nothing to upload by hand.
- Builds are uploaded by a GitHub Actions workflow in github.com/refaatt98/MaxSouqly ("iOS App Store upload").

Steps:
1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → + → App IDs → App: description "MAX Management", explicit Bundle ID com.souqly.maxmanagement. Register (skip if it already exists).
2. App Store Connect → Apps → + New App: iOS, the name, Arabic, that Bundle ID, SKU MAXMGMT001, Full Access. Create.
3. Users and Access → Integrations → App Store Connect API → Team Keys → + : name "GitHub", access "App Manager", Generate. Tell me the Key ID and Issuer ID and let ME click Download for the .p8 file.
4. Find my Team ID on developer.apple.com/account → Membership details and tell me.
5. Open github.com/refaatt98/MaxSouqly/settings/secrets/actions and create the secrets APPLE_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID. For ASC_KEY_P8 open the form and let ME paste the .p8 contents.
6. GitHub → Actions → "iOS App Store upload" → Run workflow on main. Wait until it is green (about 10–20 min). Then in App Store Connect → TestFlight wait until the build is processed; answer export compliance "None of the algorithms mentioned above" if asked.
7. App Store tab, version 1.0 (Arabic listing):
   - Subtitle: نظام إدارة المطعم
   - Promotional text: الكاشير والطلبات والمطبخ والمخزون والتقارير في تطبيق واحد
   - Description:
     MAX Management هو نظام إدارة مطعم MAX Mexicani & Burger، لصاحب المطعم وفريق العمل.
     • الكاشير: طلبات صالة وسفري وتوصيل، الدفع وطباعة الفواتير
     • الطلبات: متابعة كل طلب برقمه واسم الزبون ورقم الطاولة، مع صور الأصناف
     • المطبخ: شاشة تحضير مباشرة تتحدث لحالها
     • القائمة: الأصناف والأسعار والصور والمكونات
     • المخزون: المواد، الجرد، استلام البضاعة والموردين
     • الموظفون: الحضور، الورديات، السلف والرواتب، مع صلاحيات لكل شخص
     • التقارير: المبيعات، الأرباح، المصاريف والضرائب، مع طباعة وتصدير Excel
     الدخول بحساب يعطيه صاحب المطعم.
   - Keywords: مطعم,كاشير,نقاط بيع,طلبات,مطبخ,مخزون,تقارير,موظفين,POS,restaurant
   - Upload the iPhone 6.9" and iPad 13" screenshots from the zip.
   - Copyright: 2026 MAX Mexicani & Burger · Age rating: answer "None" to everything (4+).
   - Select the uploaded build.
   - App Review Information: sign-in required → demo@maxsouqly.app / (password: ask me); contact = my name, email and phone (ask me). Notes:
     "MAX Management is the management system of the MAX Mexicani & Burger restaurant, used by its owner and staff. Accounts are created by the owner, so please use the demo account (full owner access). The app adds native printing of receipts and reports (AirPrint) and native saving/sharing of exported Excel files. Arabic/Hebrew interface."
8. App Privacy: data collected = Name, Email Address, Phone Number, Photos, Other User Content; all "App Functionality", linked to the user, NOT used for tracking. Publish the privacy answers.
9. Pricing and Availability: Free, all countries.
10. Before "Submit for Review", show me a summary and wait for my OK.
