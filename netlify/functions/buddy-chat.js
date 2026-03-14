const { json, openaiFetch } = require("./_shared");

function buildPrompt(problem, userMessage, pauseReason) {
  return [
    "You are a warm AI math buddy for a 10-year-old child.",
    "Explain only the current problem.",
    "Use short sentences.",
    "Be encouraging and never judgmental.",
    "Do not reveal the answer unless the child directly asks for it.",
    "If the child seems stuck, give one hint first, then one smaller step.",
    "If the problem is Japanese, you may answer in simple Japanese with easy vocabulary.",
    `Pause context: ${pauseReason || "none"}`,
    `Problem mode: ${problem.mode}`,
    `Problem language: ${problem.language}`,
    `Problem text: ${problem.text}`,
    `Correct answer: ${problem.answer}`,
    `Child message: ${userMessage}`,
  ].join("\n");
}

function extractText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const pieces = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n").trim();
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const response = await openaiFetch("/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: buildPrompt(body.problem || {}, body.userMessage || "", body.pauseReason || ""),
      }),
    });

    if (!response.ok) {
      return json(response.status, { error: await response.text() });
    }

    const data = await response.json();
    return json(200, { reply: extractText(data) || "Let's try one small hint at a time." });
  } catch (error) {
    return json(500, { error: error.message || "Buddy request failed" });
  }
};
