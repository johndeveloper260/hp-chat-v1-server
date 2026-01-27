const { Translate } = require("@google-cloud/translate").v2;

// Initialize Google Translate client once
// Ensure process.env.CREDENTIALS is a valid JSON string in your .env file
const CREDENTIALS = JSON.parse(process.env.CREDENTIALS);
const translate = new Translate({
  credentials: CREDENTIALS,
  projectId: CREDENTIALS.project_id,
});

exports.translateText = async (req, res) => {
  const { text, targetLang } = req.body;

  // 1. Validation
  if (!text || !targetLang || targetLang === "nil") {
    return res.status(400).json({
      success: false,
      message: "Please provide text and a valid target language.",
    });
  }

  try {
    // 2. Perform Translation
    let [translatedText] = await translate.translate(text, targetLang);

    // 3. Send Success Response
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

    // Handle specific Google API errors
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
