const { getApiKey, openaiFetch } = require("./_shared");

function instructionsFor(language) {
  if (language === "ja-JP") {
    return "Speak in warm, natural Japanese for a child. Use smooth pacing, friendly intonation, and clear pronunciation.";
  }
  return "Speak in warm, natural English for a child. Use friendly intonation, clear pronunciation, and calm pacing.";
}

function voiceFor(language) {
  return language === "ja-JP" ? "sage" : "coral";
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed",
    };
  }

  try {
    if (!getApiKey()) {
      return {
        statusCode: 503,
        body: "Missing OPENAI_API_KEY",
      };
    }

    const body = JSON.parse(event.body || "{}");
    const text = String(body.text || "").slice(0, 1800);
    const language = body.language === "ja-JP" ? "ja-JP" : "en-US";

    const response = await openaiFetch("/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voiceFor(language),
        input: text,
        format: "mp3",
        instructions: instructionsFor(language),
      }),
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: await response.text(),
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
      body: Buffer.from(arrayBuffer).toString("base64"),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: error.message || "TTS failed",
    };
  }
};
