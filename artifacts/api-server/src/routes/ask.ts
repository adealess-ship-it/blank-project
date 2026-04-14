import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { askClaude, type IndicatorContext } from "../services/claude-cli.service";
import { addUserMessage, addAssistantMessage } from "../services/chat-session.service";
import { getCachedAnswer, setCachedAnswer } from "../services/answer-cache.service";

const router: IRouter = Router();

// ─── Rate limit: max 10 requests per minute per IP ────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { answer: "ใช้งานบ่อยเกินไป กรุณารอสักครู่ 🙏", cached: false },
});

// ─── In-memory concurrency queue ───────────────────────────────
const MAX_RUNNING = 1;
const MAX_WAITING = 3;

let running = 0;
const waitQueue: Array<{ resolve: () => void }> = [];

function enqueue(): Promise<number> | null {
  if (running < MAX_RUNNING) {
    running++;
    return Promise.resolve(0); // position 0 = processing immediately
  }
  if (waitQueue.length >= MAX_WAITING) {
    return null; // queue full
  }
  const position = waitQueue.length + 1;
  const promise = new Promise<number>((resolve) => {
    waitQueue.push({ resolve: () => resolve(position) });
  });
  return promise;
}

function dequeue(): void {
  running--;
  const next = waitQueue.shift();
  if (next) {
    running++;
    next.resolve();
  }
}
// ────────────────────────────────────────────────────────────────

function getSessionId(req: { headers: Record<string, unknown> }): string {
  return (req.headers["session-id"] as string) || "default-session";
}

async function fetchIndicatorContext(authHeader?: string): Promise<IndicatorContext | undefined> {
  try {
    const headers: Record<string, string> = {};
    if (authHeader) headers["Authorization"] = authHeader;
    const resp = await fetch(`http://localhost:${process.env.PORT || 80}/api/ai/indicator-context`, { headers });
    if (resp.ok) return await resp.json() as IndicatorContext;
  } catch {
    // Indicator context unavailable — continue without it
  }
  return undefined;
}

// ─── Security: block questions about internals / secrets ────────
const BLOCKED_PATTERNS = [
  /api.?key/i, /secret/i, /password/i, /token/i,
  /database.*url/i, /db.*url/i, /\.env/i,
  /system.*prompt/i, /ignore.*instruction/i,
  /หลังบ้าน/i, /backend.*config/i,
  /source.*code/i, /file.*system/i,
];

function isBlockedQuestion(q: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(q));
}

// ─── Greeting detection ───────────────────────────────────────
const GREETING_PATTERNS = [
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ดีจ้า|ดี$|hi$|hello|hey|hola)/i,
  /^(สวัสดีครับ|สวัสดีค่ะ|ว่าไง|ไง|yo$)/i,
];

function isGreeting(q: string): boolean {
  const trimmed = q.trim();
  return GREETING_PATTERNS.some((p) => p.test(trimmed));
}
// ────────────────────────────────────────────────────────────────

function extractSuggestions(answer: string): string[] {
  if (/ต้องการ|อยาก|จะ.*ไหม|ดีไหม|ไหมครับ|ไหมค่ะ/.test(answer)) {
    return ["ใช่ ทำเลย", "ยังไม่ต้องการ", "อธิบายเพิ่ม"];
  }
  if (/backtest|ทดสอบ|ย้อนหลัง/.test(answer)) {
    return ["ไป Backtest เลย", "แก้ strategy ก่อน"];
  }
  if (/condition|flow|เพิ่ม|ปรับ/.test(answer)) {
    return ["เพิ่มเลย", "ดูตัวอย่างก่อน", "ไม่ต้องการ"];
  }
  if (/indicator|RSI|MACD|EMA|SMA/.test(answer)) {
    return ["เพิ่ม indicator นี้", "เลือก indicator อื่น", "ข้ามไปก่อน"];
  }
  return ["ใช่", "ไม่ใช่", "อธิบายเพิ่ม"];
}

// POST /api/pyai/ask
router.post("/pyai/ask", aiLimiter, async (req, res) => {
  const { question, strategyState, imageBase64 } = req.body ?? {};
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }

  // Security filter — before anything else
  if (isBlockedQuestion(question)) {
    res.json({
      answer: "ขอโทษครับ ผมตอบได้เฉพาะเรื่อง trading strategy และ indicators เท่านั้น 🙏",
      cached: false,
    });
    return;
  }

  // Greeting — respond instantly without hitting AI
  if (isGreeting(question) && !imageBase64) {
    res.json({
      answer: "สวัสดีครับ! ยินดีช่วยเหลือเรื่อง strategy ครับ วันนี้จะเริ่มจากอะไรดีครับ?",
      cached: false,
      suggestions: ["ตรวจ flow", "เพิ่ม condition", "สร้าง strategy ใหม่", "อธิบาย indicator"],
    });
    return;
  }

  const sessionId = getSessionId(req);
  const conversationHistory = addUserMessage(sessionId, question);

  // Check cache — bypasses queue entirely (skip if image attached)
  if (!imageBase64) {
    const cached = getCachedAnswer(question);
    if (cached) {
      addAssistantMessage(sessionId, cached.answer);
      res.setHeader("X-Queue-Position", "0");
      res.json({ answer: cached.answer, cached: true, suggestions: extractSuggestions(cached.answer) });
      return;
    }
  }

  // Try to enter queue
  const slot = enqueue();
  if (slot === null) {
    console.log(`[queue] REJECTED — running: ${running}, waiting: ${waitQueue.length}`);
    res.status(429).json({ error: "ระบบยุ่งอยู่ กรุณาลองใหม่ในอีกสักครู่" });
    return;
  }

  const position = await slot;
  if (position > 0) {
    console.log(`[queue] waited at position ${position}, now processing — waiting: ${waitQueue.length}`);
  } else {
    console.log(`[queue] processing immediately — waiting: ${waitQueue.length}`);
  }
  res.setHeader("X-Queue-Position", String(position));

  try {
    // Fetch indicator context for enriched system prompt
    const indicatorContext = await fetchIndicatorContext(req.headers.authorization as string);

    // Build strategy context from frontend state — pass raw formulas
    const context = {
      flows: strategyState?.flows?.map((f: { name: string; conditions: { formula: string }[]; actions: { formula: string }[]; result: string }) => ({
        name: f.name,
        conditions: f.conditions?.map((c: { formula: string }) => c.formula) ?? [],
        actions: f.actions?.map((a: { formula: string }) => a.formula) ?? [],
        result: f.result,
      })),
      connectionCount: strategyState?.connectionCount ?? 0,
      conversationHistory,
      indicatorContext,
      imageBase64: typeof imageBase64 === "string" ? imageBase64 : undefined,
    };

    const abortController = new AbortController();
    req.on("close", () => abortController.abort());

    const answer = await askClaude(question, context, abortController.signal);
    addAssistantMessage(sessionId, answer);
    if (!imageBase64) setCachedAnswer(question, answer);
    res.json({ answer, cached: false, suggestions: extractSuggestions(answer) });
  } catch (err) {
    if ((err as Error).message === "Aborted") return;
    console.error("Claude CLI error:", err);
    res.status(500).json({ error: "AI ไม่สามารถตอบได้ในขณะนี้ ลองใหม่อีกครั้ง" });
  } finally {
    dequeue();
  }
});

export default router;
