import { v2 } from "@google-cloud/translate";
const { Translate } = v2;

// DEBUG: Log the first few characters to see why it fails
console.log("CREDENTIALS check:", process.env.CREDENTIALS?.substring(0, 20));

let CREDENTIALS;
try {
  CREDENTIALS = JSON.parse(process.env.CREDENTIALS);
} catch (e) {
  console.error("FATAL: CREDENTIALS is not valid JSON. Check your .env file.");
}

const translate = new Translate({
  credentials: CREDENTIALS,
  projectId: CREDENTIALS?.project_id,
});

export const translateText = async (req, res) => {
  const { text, targetLang } = req.body;

  if (!text || !targetLang || targetLang === "nil") {
    return res.status(400).json({
      success: false,
      message: "Please provide text and a valid target language.",
    });
  }

  try {
    // google-cloud/translate returns [string, any] where second element is metadata
    // By not passing a 'from' language, Google automatically triggers detection
    let [translatedText, metadata] = await translate.translate(
      text,
      targetLang,
    );

    // Defensive check: extract the detected source language safely
    // The structure is metadata.detections[inputIndex][detectionIndex].language
    const detectedSource =
      metadata?.detections?.[0]?.[0]?.language || "unknown";

    return res.status(200).json({
      success: true,
      data: {
        original: text,
        translated: translatedText,
        targetLanguage: targetLang,
        detectedSource: detectedSource, // Now safely extracted
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
