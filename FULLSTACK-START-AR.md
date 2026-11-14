# VELQOZA AI — دعم Full-Stack

هذه النسخة مبنية على مشروع Multi-Page الجديد (React + TypeScript + Express)، وليست نسخة Ollama القديمة.

## التشغيل على ويندوز

1. فك الضغط، وافتح PowerShell في مجلد `velqoza-ai` الذي يحتوي `package.json`.
2. نفّذ `npm.cmd install`.
3. احتفظ بملف `.env` الخاص بك في مكانه الصحيح؛ لا ترفع أسراراً أو قاعدة بيانات إلى GitHub. لا تنسَ JWT_SECRET بطول 32 حرفاً على الأقل.
4. نفّذ `npm.cmd run dev`، وافتح `http://localhost:5173`.
5. جرّب توليد تطبيق Full-Stack ووصف Backend بوضوح في الطلب، ثم انقر Export ZIP.

## شكل الملفات الناتجة

- صفحات HTML منفصلة (`index.html`, `contact.html`, `admin.html` ...) وملفا `styles.css`, `script.js`.
- ملفات مصدر إضافية: `server.js`, `package.json`, `server/db.js`, `.env.example`, `tests/...` حسب الطلب.
- تُحفظ هذه الملفات عند Save Project وتُصدّر في ZIP بالمسارات الأصلية.

## مهم للأمان

**معاينة VELQOZA AI لا تشغّل الخادم الذي يولّده النموذج.** فتح HTML وحده لا يكفي لاختبار Backend أو SQLite. شغّل المشروع الناتج في بيئة منفصلة بعد مراجعة الكود والاعتمادات، واستخدم بيانات تجريبية فقط. لم نختبر تشغيل Backend مولّد بواسطة OpenAI API في هذه البيئة.

اختبار قواعد الملفات: `npm.cmd --workspace server run test`.
لا تنسخ `.env` أو قواعد البيانات القديمة إلى نسخ تُنشر للعلن.
