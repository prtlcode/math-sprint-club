const OPENAI_API_URL = "https://api.openai.com/v1";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

async function openaiFetch(path, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  return fetch(`${OPENAI_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });
}

module.exports = {
  json,
  getApiKey,
  openaiFetch,
};
