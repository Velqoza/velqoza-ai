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
    "ابحث في المحادثات",
    "חיפוש שיחות"
  ],
  "My Projects": [
    "مشاريعي",
    "הפרויקטים שלי"
  ],
  "Your conversations will appear here.": [
    "محادثاتك راح تظهر هون.",
    "השיחות שלך יופיעו כאן."
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
    "ניפוי שגיאות בקוד"
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
  ]
}
export function translate(language:UiLanguage,english:string):string{
  if(language==='en')return english
  return translations[english]?.[language==='ar'?0:1]||english
}
