import { getModel } from "./settings";
import { log } from "./log";

type Message = { role: "system" | "user" | "assistant"; content: string };

function apiKey(): string | undefined {
  return process.env.OPENROUTEURAPI || process.env.OPENROUTER_API_KEY;
}

export function aiConfigured(): boolean {
  return Boolean(apiKey());
}

/** Appelle le modèle (OpenRouter) et renvoie la réponse JSON parsée. */
export async function askJSON<T>(messages: Message[], opts: { maxTokens?: number } = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("Clé OpenRouter absente (OPENROUTEURAPI dans .env)");
  const model = getModel();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://budget.samuelboudet.com",
      "X-Title": "Budget Famille",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 2000,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const text = await res.text();
    log("ai", `OpenRouter ${res.status} (${model}) : ${text.slice(0, 300)}`, "error");
    throw new Error(`OpenRouter ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseJSON<T>(content);
}

function parseJSON<T>(content: string): T {
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error(`Réponse IA non JSON : ${content.slice(0, 200)}`);
  }
}
