export type UiLanguage='en'|'ar'|'he'
export const LANGUAGE_STORAGE_KEY='velqoza_ui_language_v1'
export const languageOptions=[{value:'en',label:'English'},{value:'ar',label:'العربية'},{value:'he',label:'עברית'}] as const
export function isUiLanguage(value:string|null):value is UiLanguage{return value==='en'||value==='ar'||value==='he'}
export const isRtlLanguage=(language:UiLanguage)=>language==='ar'||language==='he'
const translations:Record<string,[string,string]> = {
  "My projects": [
    "مشاريعي",
    "הפרויקטים שלי"
  ],
  "Account": [
    "الحساب",
    "חשבון"
  ],
  "Log in": [
    "تسجيل الدخول",
    "התחברות"
  ],
  "Get started": [
    "ابدأ الآن",
    "מתחילים"
  ],
  "Log out": [
    "تسجيل الخروج",
    "התנתקות"
  ],
  "Credits": [
    "الرصيد",
    "קרדיטים"
  ],
  "Chat": [
    "المحادثة",
    "צ'אט"
  ],
  "AI Studio": [
    "استوديو الذكاء الاصطناعي",
    "סטודיו AI"
  ],
  "Website Builder": [
    "منشئ المواقع",
    "בונה אתרים"
  ],
  "New conversation": [
    "محادثة جديدة",
    "שיחה חדשה"
  ],
  "Search conversations": [
    "بحث في المحادثات",
    "חיפוש שיחות"
  ],
  "My Projects": [
    "مشاريعي",
    "הפרויקטים שלי"
  ],
  "Your conversations will appear here.": [
    "محادثاتك رح تظهر هون.",
    "השיחות שלכם יופיעו כאן."
  ],
  "Manage memory": [
    "إدارة الذاكرة",
    "ניהול זיכרון"
  ],
  "Plugins": [
    "إضافات",
    "תוספים"
  ],
  "Project attached": [
    "المشروع مرفق",
    "פרויקט מצורף"
  ],
  "Project context": [
    "سياق المشروع",
    "הקשר הפרויקט"
  ],
  "What will we": [
    "ماذا سنقوم",
    "מה"
  ],
  "create today?": [
    "بإنشائه اليوم؟",
    "ניצור היום?"
  ],
  "Message VELQOZA AI...": [
    "اكتب رسالة إلى VELQOZA AI...",
    "כתבו הודעה ל־VELQOZA AI..."
  ],
  "You can type your next message while AI responds...": [
    "يمكنك كتابة رسالتك التالية خلال الرد...",
    "אפשר לכתוב את ההודעה הבאה בזמן שה־AI עונה..."
  ],
  "Thinking through your request...": [
    "جاري التفكير في طلبك...",
    "חושב על הבקשה שלך..."
  ],
  "Copy": [
    "نسخ",
    "העתקה"
  ],
  "Build this project": [
    "ابنِ هذا المشروع",
    "בניית הפרויקט"
  ],
  "Messages left": [
    "الرسائل المتبقية",
    "הודעות נותרו"
  ],
  "Send message": [
    "إرسال رسالة",
    "שליחת הודעה"
  ],
  "AI can make mistakes. Chat replies do not automatically change your website or execute code.": [
    "الذكاء الاصطناعي ممكن يخطئ. ردود الدردشة لا تعدّل الموقع أو تشغّل الكود تلقائيًا.",
    "הבינה המלאכותית עלולה לטעות. תשובות בצ'אט אינן משנות את האתר או מריצות קוד אוטומטית."
  ],
  "Turn your ideas into": [
    "حوّل أفكارك إلى",
    "הפכו רעיונות ל־"
  ],
  "websites with AI.": [
    "مواقع بالذكاء الاصطناعي.",
    "אתרים בעזרת AI."
  ],
  "Build polished websites with AI, edit by chat, and keep every project in your workspace. Credits are required for AI generation, edits and chat. No recurring subscription.": [
    "أنشئ مواقع احترافية بالذكاء الاصطناعي وعدّلها بالمحادثة واحفظ مشاريعك. تحتاج رصيدًا للإنشاء والتعديل والدردشة. بدون اشتراك دوري.",
    "צרו אתרים מקצועיים בעזרת AI, ערכו בצ'אט ושמרו כל פרויקט. יצירה, עריכה וצ'אט דורשים קרדיטים, ללא מנוי מתחדש."
  ],
  "View credit packs →": [
    "عرض الباقات ←",
    "הצגת חבילות ←"
  ],
  "START WITH A PROMPT": [
    "ابدأ بوصف فكرتك",
    "מתחילים מתיאור"
  ],
  "Credits required": [
    "يلزم رصيد",
    "נדרשים קרדיטים"
  ],
  "I want a premium website for my creative studio. It should feel bold, minimal, and have a striking hero section...": [
    "بدي موقع فاخر لاستوديو إبداعي، بتصميم عصري وبسيط وقسم رئيسي مميز...",
    "אני רוצה אתר יוקרתי לסטודיו יצירתי, עם עיצוב מודרני, מינימליסטי וכותרת ראשית מרשימה..."
  ],
  "Generate website": [
    "إنشاء الموقع",
    "יצירת אתר"
  ],
  "Creating...": [
    "جاري الإنشاء...",
    "יוצר..."
  ],
  "Attach media": [
    "إرفاق ملفات",
    "צירוף מדיה"
  ],
  "Import ZIP": [
    "استيراد ZIP",
    "ייבוא ZIP"
  ],
  "Uploading…": [
    "جاري الرفع…",
    "מעלה…"
  ],
  "Generations left": [
    "عمليات الإنشاء المتبقية",
    "יצירות נותרו"
  ],
  "COLOR DIRECTION": [
    "اتجاه الألوان",
    "כיוון צבעים"
  ],
  "TRY AN IDEA": [
    "جرّب فكرة",
    "נסו רעיון"
  ],
  "Or open AI Studio — chat, plan, and use plugins": [
    "أو افتح AI Studio — محادثة وتخطيط وإضافات",
    "או פתחו AI Studio — שיחה, תכנון ותוספים"
  ],
  "Made for creators, founders & dreamers": [
    "مصمم للمبدعين ورواد الأعمال والحالمين",
    "נוצר ליוצרים, יזמים וחולמים"
  ],
  "AI-powered creation": [
    "إنشاء بالذكاء الاصطناعي",
    "יצירה בעזרת AI"
  ],
  "Plan a website": [
    "خطط لموقع",
    "תכנון אתר"
  ],
  "Debug my code": [
    "إصلاح الكود",
    "תיקון קוד"
  ],
  "Improve my design": [
    "تحسين التصميم",
    "שיפור העיצוב"
  ],
  "Launch checklist": [
    "قائمة الإطلاق",
    "רשימת השקה"
  ],
  "Admin": [
    "الإدارة",
    "ניהול"
  ],
  "Save": [
    "حفظ",
    "שמירה"
  ],
  "Download": [
    "تنزيل",
    "הורדה"
  ],
  "Preview": [
    "معاينة",
    "תצוגה מקדימה"
  ],
  "Edit": [
    "تعديل",
    "עריכה"
  ],
  "Delete": [
    "حذف",
    "מחיקה"
  ],
  "Cancel": [
    "إلغاء",
    "ביטול"
  ],
  "Settings": [
    "الإعدادات",
    "הגדרות"
  ],
  "Projects": [
    "المشاريع",
    "פרויקטים"
  ],
  "Close": [
    "إغلاق",
    "סגירה"
  ],
  "Search": [
    "بحث",
    "חיפוש"
  ],
  "Language": [
    "اللغة",
    "שפה"
  ],
  "English": [
    "الإنجليزية",
    "אנגלית"
  ],
  "Arabic": [
    "العربية",
    "ערבית"
  ],
  "Hebrew": [
    "العبرية",
    "עברית"
  ],
  "New project": [
    "مشروع جديد",
    "פרויקט חדש"
  ],
  "Open": [
    "فتح",
    "פתיחה"
  ],
  "Create": [
    "إنشاء",
    "יצירה"
  ],
  "Publish": [
    "نشر",
    "פרסום"
  ],
  "Design": [
    "تصميم",
    "עיצוב"
  ],
  "Code": [
    "الكود",
    "קוד"
  ],
  "Home": [
    "الرئيسية",
    "בית"
  ],
  "Features": [
    "المميزات",
    "תכונות"
  ],
  "Pricing": [
    "الأسعار",
    "מחירים"
  ],
  "Contact": [
    "تواصل",
    "יצירת קשר"
  ],
  "Manage": [
    "إدارة",
    "ניהול"
  ],
  "Back": [
    "رجوع",
    "חזרה"
  ],
  "Continue": [
    "متابعة",
    "המשך"
  ],
  "Confirm": [
    "تأكيد",
    "אישור"
  ],
  "Name": [
    "الاسم",
    "שם"
  ],
  "Email": [
    "البريد الإلكتروني",
    "אימייל"
  ],
  "Password": [
    "كلمة المرور",
    "סיסמה"
  ],
  "Sign up": [
    "إنشاء حساب",
    "הרשמה"
  ],
  "Forgot password?": [
    "نسيت كلمة المرور؟",
    "שכחת סיסמה?"
  ],
  "Choose a language": [
    "اختر اللغة",
    "בחרו שפה"
  ],
  "AI WEBSITE GENERATION": [
    "إنشاء مواقع بالذكاء الاصطناعي",
    "יצירת אתרים עם AI"
  ],
  "EDITS": [
    "التعديلات",
    "עריכות"
  ],
  "STUDIO CHAT": [
    "دردشة الاستوديو",
    "צ'אט הסטודיו"
  ],
  "BUILD WITH CREDITS · PAY AS YOU CREATE": [
    "أنشئ بالرصيد · ادفع حسب الاستخدام",
    "יוצרים עם קרדיטים · משלמים לפי שימוש"
  ],
  "How it works": [
    "كيف يعمل",
    "איך זה עובד"
  ],
  "Build beyond imagination.": [
    "ابنِ أبعد من الخيال.",
    "בונים מעבר לדמיון."
  ],
  "Back to home": [
    "العودة للرئيسية",
    "חזרה לדף הבית"
  ],
  "Media": [
    "الوسائط",
    "מדיה"
  ],
  "Undo AI edit": [
    "تراجع عن تعديل AI",
    "ביטול עריכת AI"
  ],
  "History": [
    "السجل",
    "היסטוריה"
  ],
  "Files": [
    "الملفات",
    "קבצים"
  ],
  "Export ZIP": [
    "تصدير ZIP",
    "ייצוא ZIP"
  ],
  "VELQOZA assistant": [
    "مساعد VELQOZA",
    "העוזר של VELQOZA"
  ],
  "AI DESIGN PARTNER": [
    "شريك التصميم بالذكاء الاصطناعي",
    "שותף עיצוב AI"
  ],
  "CURRENT PROJECT": [
    "المشروع الحالي",
    "הפרויקט הנוכחי"
  ],
  "Your website is ready to refine.": [
    "موقعك جاهز للتعديل والتحسين.",
    "האתר שלך מוכן לשיפורים."
  ],
  "What should we improve?": [
    "شو بدك نحسّن؟",
    "מה נשפר?"
  ],
  "Ask for a change and I'll update your existing website code.": [
    "اطلب أي تعديل، وأنا بحدّث كود موقعك الحالي.",
    "בקשו שינוי ואעדכן את הקוד של האתר הקיים."
  ],
  "Make the design more premium": [
    "خلّي التصميم أفخم",
    "הפוך את העיצוב ליוקרתי יותר"
  ],
  "Add a pricing section": [
    "أضف قسم الأسعار",
    "הוסף אזור מחירים"
  ],
  "Improve mobile responsiveness": [
    "حسّن التوافق مع الموبايل",
    "שפר התאמה לנייד"
  ],
  "Use a darker color palette": [
    "استعمل ألوانًا أغمق",
    "השתמש בפלטת צבעים כהה יותר"
  ],
  "Updating your website...": [
    "جاري تحديث موقعك...",
    "מעדכן את האתר..."
  ],
  "Tell me what you'd like to change, or drop media here...": [
    "احكيلي شو بدك تغيّر، أو اسحب ملف هون...",
    "מה תרצו לשנות? אפשר גם לגרור קובץ לכאן..."
  ],
  "Uploading attachment…": [
    "جاري رفع الملف…",
    "מעלה קובץ…"
  ],
  "↵ Enter to send · drag media here": [
    "↵ إنتر للإرسال · اسحب الملفات هون",
    "↵ Enter לשליחה · גררו מדיה לכאן"
  ],
  "Copy code": [
    "نسخ الكود",
    "העתקת קוד"
  ],
  "View credits": [
    "عرض الرصيد",
    "הצגת קרדיטים"
  ],
  "Create account": [
    "إنشاء حساب",
    "יצירת חשבון"
  ],
  "one-time": [
    "دفعة واحدة",
    "תשלום חד־פעמי"
  ],
  "Clear usage. No surprise auto-charges.": [
    "استخدام واضح، بدون خصومات مفاجئة.",
    "שימוש שקוף, ללא חיובים מפתיעים."
  ],
  "Nothing in your way.": [
    "بدون أي عوائق.",
    "בלי מכשולים."
  ],
  "Everything you need.": [
    "كل اللي بتحتاجه.",
    "כל מה שצריך."
  ],
  "A complete creative workflow, powered by AI and designed to keep you in control.": [
    "أدوات متكاملة للإبداع بالذكاء الاصطناعي، وإنت المتحكم بكل التفاصيل.",
    "סביבת עבודה יצירתית שלמה עם AI, ואתם בשליטה."
  ],
  "THE CREATIVE ADVANTAGE": [
    "ميزة الإبداع",
    "היתרון היצירתי"
  ],
  "Ideas to websites": [
    "من فكرة لموقع",
    "מרעיון לאתר"
  ],
  "Turn natural language into complete, polished websites with real HTML, CSS and JavaScript.": [
    "حوّل وصفك لموقع متكامل بكود HTML وCSS وJavaScript حقيقي.",
    "הופכים תיאור בשפה טבעית לאתר מלא עם HTML, CSS ו־JavaScript אמיתיים."
  ],
  "Live visual preview": [
    "معاينة مباشرة",
    "תצוגה חיה"
  ],
  "See every change instantly. Switch between desktop, tablet and mobile layouts as you build.": [
    "شوف كل تعديل فورًا وجرّب العرض على الكمبيوتر والتابلت والموبايل.",
    "רואים כל שינוי מיד, במחשב, בטאבלט ובנייד."
  ],
  "Edit with conversation": [
    "تعديل بالمحادثة",
    "עריכה בשיחה"
  ],
  "Tell your AI assistant what to change. Your existing design evolves with every instruction.": [
    "احكي للمساعد شو يغيّر، وهو بطوّر تصميمك مع كل طلب.",
    "ספרו לעוזר מה לשנות והעיצוב ישתפר עם כל בקשה."
  ],
  "Your code, always": [
    "الكود ملكك",
    "הקוד תמיד שלכם"
  ],
  "Download clean source files or export the complete project as a ZIP. No lock-in.": [
    "نزّل ملفات الكود أو صدّر المشروع كاملًا كـ ZIP.",
    "הורידו את קבצי המקור או ייצאו את הפרויקט כ־ZIP."
  ],
  "Projects that stay yours": [
    "مشاريعك محفوظة",
    "הפרויקטים נשארים שלכם"
  ],
  "Save your work, reopen previous builds and keep every idea organized in one workspace.": [
    "احفظ شغلك وافتح مشاريعك القديمة وقت ما بدك.",
    "שמרו את העבודה ופתחו פרויקטים קודמים בכל עת."
  ],
  "AI Studio + tools": [
    "استوديو AI وأدواته",
    "AI Studio וכלים"
  ],
  "Keep conversations, plan new ideas and use opt-in local project audit plugins.": [
    "احفظ محادثاتك وخطّط لأفكارك واستعمل أدوات فحص المشاريع.",
    "שמרו שיחות, תכננו רעיונות והשתמשו בכלי בדיקת פרויקטים."
  ],
  "A BETTER WAY TO BUILD": [
    "طريقة أسهل للبناء",
    "דרך טובה יותר לבנות"
  ],
  "From blank page to": [
    "من صفحة فاضية إلى",
    "מדף ריק עד"
  ],
  "brand new website.": [
    "موقع جديد بالكامل.",
    "לאתר חדש לגמרי."
  ],
  "Describe it": [
    "اوصف فكرتك",
    "תארו את הרעיון"
  ],
  "Generate it": [
    "أنشئه",
    "צרו אותו"
  ],
  "Make it yours": [
    "خلّيه على ذوقك",
    "התאימו לטעמכם"
  ],
  "Share your idea, choose a category, and set the visual direction.": [
    "اكتب فكرتك، واختار نوع الموقع وشكل التصميم.",
    "שתפו רעיון, בחרו קטגוריה וסגנון עיצוב."
  ],
  "The AI turns your brief into a complete website and working code.": [
    "الذكاء الاصطناعي يحوّل وصفك لموقع كامل بكود شغّال.",
    "ה־AI הופך את התיאור לאתר עם קוד עובד."
  ],
  "Preview, refine with chat, save your project and export your code.": [
    "عاين الموقع، عدّله بالمحادثة، واحفظ وصدّر الكود.",
    "צפו, ערכו בצ'אט, שמרו וייצאו את הקוד."
  ],
  "PAY AS YOU BUILD": [
    "ادفع حسب استخدامك",
    "משלמים לפי שימוש"
  ],
  "Build more.": [
    "ابنِ أكثر.",
    "בונים יותר."
  ],
  "Pay only when you create.": [
    "وادفع وقت الإنشاء فقط.",
    "משלמים רק כשיוצרים."
  ],
  "No recurring subscription. Buy a credit pack when you need one, then use credits for AI generation, edits and AI Studio conversations. These are preview prices; online checkout is not available yet.": [
    "بدون اشتراك متجدد. اشترِ رصيدًا عند الحاجة للإنشاء والتعديل والمحادثة. الأسعار مبدئية والدفع الإلكتروني غير متاح حاليًا.",
    "ללא מנוי מתחדש. קונים קרדיטים לפי הצורך ליצירה, עריכה וצ'אט. המחירים להמחשה בלבד והתשלום המקוון עדיין אינו זמין."
  ],
  "Business": [
    "أعمال",
    "עסקים"
  ],
  "Portfolio": [
    "معرض أعمال",
    "תיק עבודות"
  ],
  "E-commerce": [
    "متجر إلكتروني",
    "חנות מקוונת"
  ],
  "Restaurant": [
    "مطعم",
    "מסעדה"
  ],
  "Blog": [
    "مدونة",
    "בלוג"
  ],
  "Agency": [
    "وكالة",
    "סוכנות"
  ],
  "Landing Page": [
    "صفحة هبوط",
    "דף נחיתה"
  ],
  "SaaS": [
    "خدمة SaaS",
    "SaaS"
  ],
  "Other": [
    "أخرى",
    "אחר"
  ],
  "Minimal": [
    "بسيط",
    "מינימליסטי"
  ],
  "Modern": [
    "عصري",
    "מודרני"
  ],
  "Luxury": [
    "فاخر",
    "יוקרתי"
  ],
  "Futuristic": [
    "مستقبلي",
    "עתידני"
  ],
  "Creative": [
    "إبداعي",
    "יצירתי"
  ],
  "Starter": [
    "مبتدئ",
    "מתחילים"
  ],
  "Pro": [
    "احترافي",
    "מקצועי"
  ],
  "THIS": [
    "هذا",
    "זה"
  ],
  "ONE PROMPT. ENDLESS POSSIBILITIES.": [
    "طلب واحد، إمكانيات بلا حدود.",
    "תיאור אחד, אפשרויות בלי סוף."
  ],
  "DESIGN": [
    "تصميم",
    "עיצוב"
  ],
  "DEVELOP": [
    "تطوير",
    "פיתוח"
  ],
  "DEPLOY": [
    "نشر",
    "פרסום"
  ],
  "Drag & drop media here or click Attach media. Files up to 3 MB; they upload to your account and their URL is added to this prompt.": [
    "اسحب ملف هون أو اضغط إرفاق ملفات. الحد 3 ميغابايت، والملف ينرفع لحسابك وينضاف رابطه للوصف.",
    "גררו מדיה לכאן או לחצו על צירוף מדיה. עד 3MB, הקובץ עולה לחשבון והקישור נוסף לתיאור."
  ],
  "Your last unfinished prompt was restored": [
    "رجّعنا آخر وصف ما كملته",
    "הטיוטה האחרונה שוחזרה"
  ],
  "Clear": [
    "مسح",
    "ניקוי"
  ],
  "Drop media to attach to new website prompt": [
    "اسحب الملف هون لإرفاقه بوصف الموقع",
    "שחררו את הקובץ לצירוף לתיאור האתר"
  ],
  "Drop image, audio or video here": [
    "اسحب صورة أو صوت أو فيديو هون",
    "שחררו כאן תמונה, שמע או וידאו"
  ],
  "YOUR AI WORKSPACE": [
    "مساحة عملك الذكية",
    "סביבת העבודה החכמה שלכם"
  ],
  "Local development workspace": [
    "مساحة عمل التطوير",
    "סביבת פיתוח"
  ],
  "CREATIVE INTELLIGENCE": [
    "إبداع ذكي",
    "יצירתיות חכמה"
  ],
  "Ask anything, plan a project, debug your code, or brainstorm your next big idea. Your conversations stay organized in your account.": [
    "اسأل أي شيء، خطّط لمشروع، أصلح الكود أو طوّر فكرة جديدة. محادثاتك محفوظة بحسابك.",
    "שאלו כל דבר, תכננו פרויקט, תקנו קוד או פתחו רעיון חדש. השיחות מסודרות בחשבון."
  ],
  "Help me plan a premium barbershop website.": [
    "ساعدني أخطّط لموقع حلاقة فاخر.",
    "עזור לי לתכנן אתר יוקרתי למספרה."
  ],
  "Help me troubleshoot a JavaScript error.": [
    "ساعدني أصلّح خطأ JavaScript.",
    "עזור לי לתקן שגיאת JavaScript."
  ],
  "What makes a website feel premium and cinematic?": [
    "كيف أخلي الموقع فخم وسينمائي؟",
    "מה הופך אתר ליוקרתי וקולנועי?"
  ],
  "Give me a practical checklist for launching a small business website.": [
    "اعطيني قائمة عملية لإطلاق موقع شركة صغيرة.",
    "תן לי רשימה מעשית להשקת אתר לעסק קטן."
  ],
  "Error": [
    "خطأ",
    "שגיאה"
  ],
  "Dismiss": [
    "إغلاق",
    "סגירה"
  ],
  "No pinned memories yet.": [
    "ما في ذكريات محفوظة بعد.",
    "עדיין אין זיכרונות שמורים."
  ],
  "Save memory": [
    "حفظ معلومة",
    "שמירת זיכרון"
  ],
  "New memory": [
    "معلومة جديدة",
    "זיכרון חדש"
  ],
  "TOOLS & EXTENSIONS": [
    "الأدوات والإضافات",
    "כלים ותוספים"
  ],
  "Built-in plugins": [
    "إضافات مدمجة",
    "תוספים מובנים"
  ],
  "Enable local analysis tools. External services aren't connected.": [
    "فعّل أدوات التحليل المحلية. الخدمات الخارجية غير متصلة.",
    "הפעילו כלי ניתוח מקומיים. שירותים חיצוניים אינם מחוברים."
  ],
  "Review files": [
    "مراجعة الملفات",
    "בדיקת קבצים"
  ],
  "Start building": [
    "ابدأ الإنشاء",
    "התחילו ליצור"
  ],
  "Open sidebar": [
    "فتح القائمة",
    "פתיחת תפריט"
  ],
  "Collapse sidebar": [
    "إخفاء القائمة",
    "סגירת תפריט"
  ],
  "Open memory": [
    "فتح الذاكرة",
    "פתיחת זיכרון"
  ],
  "Website language": [
    "لغة الموقع",
    "שפת האתר"
  ],
  "Auto-detect language": [
    "تحديد اللغة تلقائيًا",
    "זיהוי שפה אוטומטי"
  ],
  "ACCOUNT MEMORY": [
    "ذاكرة الحساب",
    "זיכרון החשבון"
  ],
  "What VELQZA remembers": [
    "شو بتذكّر VELQOZA",
    "מה VELQOZA זוכר"
  ]
}
export function translate(language:UiLanguage,english:string):string{
  if(language==='en')return english
  return translations[english]?.[language==='ar'?0:1]||english
}
