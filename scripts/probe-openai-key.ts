import "dotenv/config";

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

console.log("keyPrefix", key.slice(0, 7), "len", key.length, "model", model);

const url = "https://api.openai.com/v1/chat/completions";
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: 'Reply with a JSON object only: {"reply":"hello"}',
      },
      { role: "user", content: "hi" },
    ],
    max_tokens: 16,
    response_format: { type: "json_object" },
  }),
});

console.log("status", res.status);
console.log((await res.text()).slice(0, 1200));
