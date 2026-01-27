import { v2 } from "@google-cloud/translate";
const { Translate } = v2;

const CREDENTIALS = JSON.parse(process.env.CREDENTIALS);
const translate = new Translate({
  credentials: CREDENTIALS,
  projectId: CREDENTIALS.project_id,
});

// 2. Keep this as 'export const'
export const translateText = async (req, res) => {
  const { text, targetLang } = req.body;

  if (!text || !targetLang || targetLang === "nil") {
    return res.status(400).json({
      success: false,
      message: "Please provide text and a valid target language.",
    });
  }

  try {
    let [translatedText] = await translate.translate(text, targetLang);

    return res.status(200).json({
      success: true,
      data: {
        original: text,
        translated: translatedText,
        language: targetLang,
      },
    });
  } catch (err) {
    console.error("Google Translate Error:", err.message);

    if (err.code === 3) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid language code." });
    }

    res
      .status(500)
      .json({ success: false, message: "Translation failed on server." });
  }
};
