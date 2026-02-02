/**
 * Notification Translations
 * Keep these synchronized with frontend i18n files
 */
const translations = {
  // Comment Notifications
  comment_on_inquiry: {
    en: "New comment on Inquiry",
    ja: "問い合わせに新しいコメント",
    id: "Komentar baru pada Pertanyaan",
    vi: "Bình luận mới về Yêu cầu",
  },
  comment_on_announcement: {
    en: "New comment on Announcement",
    ja: "掲示板に新しいコメント",
    id: "Komentar baru pada Pengumuman",
    vi: "Bình luận mới về Thông báo",
  },

  // Inquiry Notifications
  new_inquiry: {
    en: "New Inquiry",
    ja: "新しい問い合わせ",
    id: "Pertanyaan Baru",
    vi: "Yêu cầu mới",
  },
  high_priority: {
    en: "(High Priority)",
    ja: "（高優先度）",
    id: "(Prioritas Tinggi)",
    vi: "(Ưu tiên cao)",
  },
  created_inquiry: {
    en: "created a new inquiry",
    ja: "が新しい問い合わせを作成しました",
    id: "membuat pertanyaan baru",
    vi: "đã tạo yêu cầu mới",
  },
  inquiry_updated: {
    en: "Inquiry Updated",
    ja: "問い合わせが更新されました",
    id: "Pertanyaan Diperbarui",
    vi: "Yêu cầu đã cập nhật",
  },
  updated_inquiry: {
    en: "updated the inquiry",
    ja: "が問い合わせを更新しました",
    id: "memperbarui pertanyaan",
    vi: "đã cập nhật yêu cầu",
  },
  changed_status_to: {
    en: "changed status to",
    ja: "がステータスを変更しました：",
    id: "mengubah status menjadi",
    vi: "đã thay đổi trạng thái thành",
  },
  assigned_to_you: {
    en: "assigned this inquiry to you",
    ja: "があなたにこの問い合わせを割り当てました",
    id: "menugaskan pertanyaan ini kepada Anda",
    vi: "đã giao yêu cầu này cho bạn",
  },

  // Call Notifications
  incoming_call: {
    en: "Incoming Video Call 📞",
    ja: "着信ビデオ通話 📞",
    id: "Panggilan Video Masuk 📞",
    vi: "Cuộc gọi video đến 📞",
  },
  calling_you: {
    en: "is calling you...",
    ja: "から着信中...",
    id: "sedang menelepon Anda...",
    vi: "đang gọi cho bạn...",
  },
  comment_body: {
    en: "{{name}}: {{comment}}",
    ja: "{{name}}: {{comment}}",
    id: "{{name}}: {{comment}}",
    vi: "{{name}}: {{comment}}",
  },
};

/**
 * Get translated text for a key in the user's language
 */
export const getTranslation = (key, language = "en") => {
  const validLanguages = ["en", "ja", "id", "vi"];
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
