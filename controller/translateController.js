import { v2 } from "@google-cloud/translate";
const { Translate } = v2;

// DEBUG: Log the first few characters to see why it fails
console.log("CREDENTIALS check:", process.env.CREDENTIALS?.substring(0, 20));

let CREDENTIALS;
try {
  CREDENTIALS = JSON.parse(process.env.CREDENTIALS);
} catch (e) {
  console.error("FATAL: CREDENTIALS is not valid JSON. Check your .env file.");
  // Optional: if it's not JSON, you might need to wrap it or fix it manually
}

const translate = new Translate({
  credentials: CREDENTIALS,
  projectId: CREDENTIALS?.project_id,
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
    // google-cloud/translate returns [translatedText, metadata]
    // metadata.detections[0].language contains the auto-detected source
    let [translatedText, metadata] = await translate.translate(
      text,
      targetLang,
    );

    return res.status(200).json({
      success: true,
      data: {
        original: text,
        translated: translatedText,
        targetLanguage: targetLang,
        detectedSource: metadata.detections[0][0].language, // This is the auto-detected code
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
