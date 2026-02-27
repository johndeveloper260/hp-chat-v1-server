/**
 * Notification Translations
 * Keep these synchronized with frontend i18n files
 */
const translations = {
  // Comment Notifications
  comment_on_inquiry: {
    en: "New comment on Inquiry",
    ja: "報告に新しいコメント",
    id: "Komentar baru pada Pertanyaan",
    vi: "Bình luận mới về Yêu cầu",
    my: "စုံစမ်းချက်တွင် မှတ်ချက်အသစ်",
    km: "មតិយោបល់ថ្មីលើការសាកសួរ",
    bn: "অনুসন্ধানে নতুন মন্তব্য",
    th: "ความคิดเห็นใหม่เกี่ยวกับการสอบถาม",
  },
  comment_on_announcement: {
    en: "New comment on Announcement",
    ja: "掲示板に新しいコメント",
    id: "Komentar baru pada Pengumuman",
    vi: "Bình luận mới về Thông báo",
    my: "ကြေညာချက်တွင် မှတ်ချက်အသစ်",
    km: "មតិយោបល់ថ្មីលើការប្រកាស",
    bn: "ঘোষণায় নতুন মন্তব্য",
    th: "ความคิดเห็นใหม่เกี่ยวกับประกาศ",
  },

  // Inquiry Notifications
  new_inquiry: {
    en: "New Inquiry",
    ja: "新しい報告",
    id: "Pertanyaan Baru",
    vi: "Yêu cầu mới",
    my: "စုံစမ်းချက်အသစ်",
    km: "ការសាកសួរថ្មី",
    bn: "নতুন অনুসন্ধান",
    th: "การสอบถามใหม่",
  },
  high_priority: {
    en: "(High Priority)",
    ja: "（高優先度）",
    id: "(Prioritas Tinggi)",
    vi: "(Ưu tiên cao)",
    my: "(ဦးစားပေးမြင့်မား)",
    km: "(អាទិភាពខ្ពស់)",
    bn: "(উচ্চ অগ্রাধিকার)",
    th: "(ความสำคัญสูง)",
  },
  created_inquiry: {
    en: "created a new inquiry",
    ja: "が新しい報告を作成しました",
    id: "membuat pertanyaan baru",
    vi: "đã tạo yêu cầu mới",
    my: "စုံစမ်းချက်အသစ် ဖန်တီးခဲ့သည်",
    km: "បានបង្កើតការសាកសួរថ្មី",
    bn: "নতুন অনুসন্ধান তৈরি করেছেন",
    th: "สร้างการสอบถามใหม่",
  },
  inquiry_updated: {
    en: "Inquiry Updated",
    ja: "報告が更新されました",
    id: "Pertanyaan Diperbarui",
    vi: "Yêu cầu đã cập nhật",
    my: "စုံစမ်းချက် အပ်ဒိတ်လုပ်ပြီးပါပြီ",
    km: "ការសាកសួរត្រូវបានអាប់ដេត",
    bn: "অনুসন্ধান আপডেট হয়েছে",
    th: "การสอบถามได้รับการอัปเดต",
  },
  new_inquiry_high_priority: {
    en: "New Inquiry (High Priority)",
    ja: "新しい報告（高優先度）",
    id: "Pertanyaan Baru (Prioritas Tinggi)",
    vi: "Yêu cầu mới (Ưu tiên cao)",
    my: "စုံစမ်းချက်အသစ် (ဦးစားပေးမြင့်မား)",
    km: "ការសាកសួរថ្មី (អាទិភាពខ្ពស់)",
    bn: "নতুন অনুসন্ধান (উচ্চ অগ্রাধিকার)",
    th: "การสอบถามใหม่ (ความสำคัญสูง)",
  },
  created_inquiry: {
    en: "{{name}} created a new inquiry: {{title}}",
    ja: "{{name}}が新しい報告を作成しました：{{title}}",
    id: "{{name}} membuat pertanyaan baru: {{title}}",
    vi: "{{name}} đã tạo yêu cầu mới: {{title}}",
    my: "{{name}} သည် စုံစမ်းချက်အသစ်ဖန်တီးခဲ့သည်: {{title}}",
    km: "{{name}} បានបង្កើតការសាកសួរថ្មី: {{title}}",
    bn: "{{name}} একটি নতুন অনুসন্ধান তৈরি করেছেন: {{title}}",
    th: "{{name}} สร้างการสอบถามใหม่: {{title}}",
  },
  updated_inquiry: {
    en: "{{name}} updated the inquiry",
    ja: "{{name}}が報告を更新しました",
    id: "{{name}} memperbarui pertanyaan",
    vi: "{{name}} đã cập nhật yêu cầu",
    my: "{{name}} သည် စုံစမ်းချက်ကို အပ်ဒိတ်လုပ်ခဲ့သည်",
    km: "{{name}} បានអាប់ដេតការសាកសួរ",
    bn: "{{name}} অনুসন্ধান আপডেট করেছেন",
    th: "{{name}} อัปเดตการสอบถาม",
  },
  changed_status_to: {
    en: "changed status to",
    ja: "がステータスを変更しました：",
    id: "mengubah status menjadi",
    vi: "đã thay đổi trạng thái thành",
    my: "အခြေအနေကို ပြောင်းလဲခဲ့သည်:",
    km: "បានផ្លាស់ប្តូរស្ថានភាពទៅជា",
    bn: "স্ট্যাটাস পরিবর্তন করেছেন:",
    th: "เปลี่ยนสถานะเป็น",
  },
  assigned_to_you: {
    en: "assigned this inquiry to you",
    ja: "があなたにこの報告を割り当てました",
    id: "menugaskan pertanyaan ini kepada Anda",
    vi: "đã giao yêu cầu này cho bạn",
    my: "ဤစုံစမ်းချက်ကို သင့်ထံ တာဝန်ပေးအပ်ခဲ့သည်",
    km: "បានចាត់តាំងការសាកសួរនេះទៅអ្នក",
    bn: "এই অনুসন্ধানটি আপনাকে বরাদ্দ করা হয়েছে",
    th: "ได้มอบหมายการสอบถามนี้ให้คุณ",
  },

  // Call Notifications
  incoming_call: {
    en: "Incoming Video Call 📞",
    ja: "着信ビデオ通話 📞",
    id: "Panggilan Video Masuk 📞",
    vi: "Cuộc gọi video đến 📞",
    my: "ဗီဒီယိုခေါ်ဆိုမှု ဝင်လာနေသည် 📞",
    km: "ការហៅវីដេអូចូល 📞",
    bn: "ইনকামিং ভিডিও কল 📞",
    th: "สายวิดีโอโทรเข้า 📞",
  },
  calling_you: {
    en: "is calling you...",
    ja: "から着信中...",
    id: "sedang menelepon Anda...",
    vi: "đang gọi cho bạn...",
    my: "သင့်ကို ခေါ်ဆိုနေသည်...",
    km: "កំពុងហៅអ្នក...",
    bn: "আপনাকে কল করছে...",
    th: "กำลังโทรหาคุณ...",
  },
  comment_body: {
    en: "{{name}}: {{comment}}",
    ja: "{{name}}: {{comment}}",
    id: "{{name}}: {{comment}}",
    vi: "{{name}}: {{comment}}",
    my: "{{name}}: {{comment}}",
    km: "{{name}}: {{comment}}",
    bn: "{{name}}: {{comment}}",
    th: "{{name}}: {{comment}}",
  },
};

/**
 * Get translated text for a key in the user's language
 */
export const getTranslation = (key, language = "en") => {
  const validLanguages = ["en", "ja", "id", "vi", "my", "km", "bn", "th"];
  const lang = validLanguages.includes(language) ? language : "en";

  return translations[key]?.[lang] || translations[key]?.["en"] || key;
};

/**
 * Format notification with user's language
 */
export const formatNotification = (key, language, replacements = {}) => {
  let text = getTranslation(key, language);

  // Replace placeholders like {{name}}, {{status}}
  Object.keys(replacements).forEach((placeholder) => {
    text = text.replace(`{{${placeholder}}}`, replacements[placeholder]);
  });

  return text;
};

export default { getTranslation, formatNotification };
