// AI English coach: checks a learner's sentence, or role-plays a scenario chat.
// Backed by Gemini (free tier). Quota is enforced in Postgres (consume_ai_quota)
// before any call to Gemini, so a refused call never touches the model.
// Answers are cached in public.ai_cache by a hash of the request: a repeat of
// the same check or the same conversation so far is answered from the table,
// with no model call and nothing taken from the learner's daily allowance.
//
// Secrets (set these in Supabase → Edge Functions → Secrets, not in code):
//   GEMINI_API_KEY   required — https://aistudio.google.com/apikey
//   GEMINI_MODEL     optional, default 'gemini-2.5-flash'
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 25000;

const SCENARIOS = [
  "restaurant", "job_interview", "hotel", "directions",
  "shopping", "doctor", "small_talk", "meeting",
] as const;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const CHECK_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    uses_word: { type: "boolean" },
    score: { type: "integer" },
    corrected: { type: "string" },
    feedback_th: { type: "string" },
    tips_th: { type: "array", items: { type: "string" } },
    better: { type: "string" },
  },
  required: ["ok", "uses_word", "score", "corrected", "feedback_th", "tips_th", "better"],
};

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    correction_th: { type: "string" },
    suggestion: { type: "string" },
  },
  required: ["reply", "correction_th", "suggestion"],
};

function checkPrompt(): string {
  return [
    "You are a kind, precise English coach for Thai learners.",
    "The learner was given one English word and wrote a sentence that should use it.",
    "Judge the sentence on its own grammar and natural phrasing, and whether the given word",
    "(or a normal inflection of it, e.g. plural, tense, comparative) is used with a sensible meaning.",
    "Never invent an error in a sentence that is already correct and natural — if it's fine, say so.",
    "Be specific: name the actual mistake (word, tense, preposition, word order, spelling) and why it's wrong.",
    "Reply ONLY with JSON matching the schema. feedback_th and tips_th must be in Thai, friendly and concise.",
    "corrected: the smallest fix that keeps the learner's meaning. better: a more natural or advanced",
    "alternative a native speaker might say. score: 0-10, 10 = perfect.",
  ].join(" ");
}

function chatSystemPrompt(scenario: string, level: string): string {
  const topic: Record<string, string> = {
    restaurant: "a waiter/waitress taking the learner's order at a restaurant",
    job_interview: "an interviewer interviewing the learner for a job",
    hotel: "a hotel receptionist checking the learner in or helping with their stay",
    directions: "a stranger the learner stopped on the street to ask for directions",
    shopping: "a shop assistant helping the learner buy something",
    doctor: "a doctor asking the learner about their symptoms",
    small_talk: "an acquaintance making casual small talk with the learner",
    meeting: "a colleague running a work meeting with the learner",
  };
  return [
    `You are role-playing as ${topic[scenario] ?? "the other person in a conversation"}.`,
    "Stay in character at all times — never mention you are an AI or break the scene.",
    `Reply in English written for a learner at CEFR level ${level}: short, natural, 1-3 sentences,`,
    "and end with something that invites the learner to reply (a question or a natural next line).",
    "Separately, look only at the learner's most recent message: if it is grammatically fine and natural,",
    "set correction_th to '' and suggestion to ''. If it has a real mistake, set correction_th to a short,",
    "kind Thai explanation of what was wrong and why, and suggestion to a corrected or more natural version",
    "of that same message. Never invent an error that is not really there.",
    "Reply ONLY with JSON matching the schema.",
  ].join(" ");
}

type CheckBody = { action: "check"; word: string; sentence: string };
type ChatBody = {
  action: "chat";
  scenario: string;
  level: string;
  messages: { role: "user" | "coach"; text: string }[];
};

function parseCheck(body: Record<string, unknown>): CheckBody | null {
  const word = body.word;
  const sentence = body.sentence;
  if (typeof word !== "string" || !word.trim() || word.length > 60) return null;
  if (typeof sentence !== "string" || !sentence.trim() || sentence.length > 300) return null;
  return { action: "check", word: word.trim(), sentence: sentence.trim() };
}

function parseChat(body: Record<string, unknown>): ChatBody | null {
  const scenario = body.scenario;
  const level = body.level;
  const messages = body.messages;
  if (typeof scenario !== "string" || !SCENARIOS.includes(scenario as typeof SCENARIOS[number])) return null;
  if (typeof level !== "string" || !LEVELS.includes(level as typeof LEVELS[number])) return null;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) return null;

  const clean: { role: "user" | "coach"; text: string }[] = [];
  for (const m of messages) {
    if (typeof m !== "object" || m === null) return null;
    const role = (m as Record<string, unknown>).role;
    const text = (m as Record<string, unknown>).text;
    if (role !== "user" && role !== "coach") return null;
    if (typeof text !== "string" || !text.trim() || text.length > 500) return null;
    clean.push({ role, text: text.trim() });
  }
  if (clean[clean.length - 1].role !== "user") return null;

  return { action: "chat", scenario, level, messages: clean };
}

/** What identifies a request for caching: whitespace-normalised, case kept (capitals can be the mistake). */
function cacheText(action: CheckBody | ChatBody): string {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  if (action.action === "check") return `check|${norm(action.word).toLowerCase()}|${norm(action.sentence)}`;
  return `chat|${action.scenario}|${action.level}|` + action.messages.map((m) => `${m.role}:${norm(m.text)}`).join("\n");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callGemini(
  apiKey: string, model: string, systemInstruction: string,
  contents: { role: string; parts: { text: string }[] }[], schema: unknown,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_API}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: schema },
      }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("gemini http error", res.status, data);
      return null;
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      console.error("gemini: no text in response", data);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      console.error("gemini: reply was not valid JSON", err, text);
      return null;
    }
  } catch (err) {
    console.error("gemini call failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "bad request body" }, 400);
  }
  if (!raw || typeof raw !== "object") return json({ error: "bad request body" }, 400);

  let action: CheckBody | ChatBody | null = null;
  if (raw.action === "check") action = parseCheck(raw);
  else if (raw.action === "chat") action = parseChat(raw);
  if (!action) return json({ error: "bad request body" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // A request we have answered before costs nothing.
  const cacheKey = await sha256(cacheText(action));
  const { data: cached } = await admin.from("ai_cache").select("response").eq("key", cacheKey).maybeSingle();
  if (cached?.response) {
    await admin.rpc("bump_ai_cache_hit", { p_key: cacheKey });   // bookkeeping only; a failure here is harmless
    return json({ ...cached.response, cached: true });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "ยังไม่ได้ตั้งค่า AI โค้ช (GEMINI_API_KEY)" }, 503);
  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;

  // Quota next: a refused call never reaches Gemini.
  const { data: remaining, error: quotaError } = await admin.rpc("consume_ai_quota", { p_user: user.id });
  if (quotaError) {
    console.error("consume_ai_quota failed", quotaError);
    return json({ error: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" }, 500);
  }
  if (remaining === -1) {
    return json({ error: "วันนี้ใช้ AI โค้ชครบโควตาแล้ว (ฟรี 5 ครั้ง/วัน · Pro 40 ครั้ง/วัน)" }, 429);
  }

  let result: Record<string, unknown> | null;
  if (action.action === "check") {
    result = await callGemini(
      apiKey, model, checkPrompt(),
      [{ role: "user", parts: [{ text: `Word: "${action.word}"\nSentence: "${action.sentence}"` }] }],
      CHECK_SCHEMA,
    );
  } else {
    const contents = action.messages.map((m) => ({
      role: m.role === "coach" ? "model" : "user",
      parts: [{ text: m.text }],
    }));
    // The scene opens with the coach's line, but Gemini expects a user turn first.
    if (contents[0].role === "model") {
      contents.unshift({ role: "user", parts: [{ text: "(The conversation starts.)" }] });
    }
    result = await callGemini(apiKey, model, chatSystemPrompt(action.scenario, action.level), contents, CHAT_SCHEMA);
  }

  if (!result) return json({ error: "AI โค้ชตอบไม่สำเร็จ ลองใหม่อีกครั้ง" }, 502);
  const { error: cacheError } = await admin.from("ai_cache")
    .upsert({ key: cacheKey, action: action.action, response: result }, { onConflict: "key", ignoreDuplicates: true });
  if (cacheError) console.error("ai_cache insert failed", cacheError);
  return json({ ...result, remaining });
});
