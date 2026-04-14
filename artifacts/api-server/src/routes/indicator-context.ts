import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const PYTRIGGER_BASE = process.env.PYTRIGGER_URL || "http://localhost:8000";

const STANDARD_INDICATORS = [
  { name: "RSI", description: "Relative Strength Index วัดความแข็งแกร่งของราคา", parameters: { period: 14 }, usage: "overbought > 70, oversold < 30" },
  { name: "MACD", description: "Moving Average Convergence Divergence วัด momentum", parameters: { fast: 12, slow: 26, signal: 9 }, usage: "MACD cross signal line = buy/sell signal" },
  { name: "EMA", description: "Exponential Moving Average ค่าเฉลี่ยถ่วงน้ำหนัก", parameters: { period: 9 }, usage: "price cross EMA = trend change" },
  { name: "SMA", description: "Simple Moving Average ค่าเฉลี่ยเคลื่อนที่", parameters: { period: 20 }, usage: "support/resistance แบบ dynamic" },
  { name: "BB", description: "Bollinger Bands วัดความผันผวน", parameters: { period: 20, std: 2 }, usage: "price touch upper/lower band = reversal signal" },
  { name: "Stochastic", description: "Stochastic Oscillator เปรียบเทียบ close กับ range", parameters: { k: 14, d: 3 }, usage: "overbought > 80, oversold < 20" },
  { name: "ATR", description: "Average True Range วัดความผันผวนของราคา", parameters: { period: 14 }, usage: "ใช้ตั้ง SL/TP เช่น SL = 1.5x ATR" },
  { name: "ADX", description: "Average Directional Index วัดความแข็งของเทรนด์", parameters: { period: 14 }, usage: "ADX > 25 = trending, < 20 = ranging" },
  { name: "CCI", description: "Commodity Channel Index วัด deviation จากค่าเฉลี่ย", parameters: { period: 20 }, usage: "overbought > 100, oversold < -100" },
  { name: "Williams %R", description: "Williams Percent Range คล้าย Stochastic กลับด้าน", parameters: { period: 14 }, usage: "overbought > -20, oversold < -80" },
  { name: "WMA", description: "Weighted Moving Average ค่าเฉลี่ยถ่วงน้ำหนักเชิงเส้น", parameters: { period: 20 }, usage: "เร็วกว่า SMA, ช้ากว่า EMA" },
  { name: "DEMA", description: "Double EMA ลด lag ของ EMA ปกติ", parameters: { period: 20 }, usage: "trend following ที่ต้องการ response เร็ว" },
  { name: "TEMA", description: "Triple EMA ลด lag ยิ่งกว่า DEMA", parameters: { period: 20 }, usage: "scalping, short-term trend" },
  { name: "SAR", description: "Parabolic SAR ระบุ stop-and-reverse point", parameters: { accel: 0.02, max: 0.2 }, usage: "dot flip = trend reversal, ใช้เป็น trailing stop" },
  { name: "OBV", description: "On Balance Volume วัด volume flow", parameters: {}, usage: "OBV diverge จาก price = reversal signal" },
  { name: "MFI", description: "Money Flow Index เหมือน RSI แต่ใช้ volume ด้วย", parameters: { period: 14 }, usage: "overbought > 80, oversold < 20" },
  { name: "ROC", description: "Rate of Change วัดอัตราการเปลี่ยนแปลงราคา %", parameters: { period: 12 }, usage: "ROC > 0 = bullish momentum" },
  { name: "MOM", description: "Momentum วัดการเปลี่ยนแปลงราคาแบบ absolute", parameters: { period: 10 }, usage: "MOM > 0 = upward momentum" },
];

let _stdCache: unknown[] | null = null;
let _stdCacheTime = 0;

// GET /api/ai/indicator-context
router.get("/ai/indicator-context", async (_req: Request, res: Response) => {
  let userIndicators: unknown[] = [];

  // Try to fetch user's custom indicators from FastAPI
  const token = _req.headers.authorization;
  if (token) {
    try {
      const resp = await fetch(`${PYTRIGGER_BASE}/pytrigger/indi/custom/my`, {
        headers: { Authorization: token },
      });
      if (resp.ok) {
        const data = await resp.json();
        userIndicators = Array.isArray(data) ? data : [];
      }
    } catch {
      // FastAPI unreachable — continue with empty user indicators
    }
  }

  // Fetch standard indicators from DB (cached 5 min)
  let dbIndicators: unknown[] = [];
  const now = Date.now();
  if (!_stdCache || now - _stdCacheTime > 300_000) {
    try {
      const resp = await fetch(`${PYTRIGGER_BASE}/pytrigger/indi/standard`);
      if (resp.ok) {
        const data = (await resp.json()) as { indicators?: unknown[] };
        if (data.indicators?.length) {
          _stdCache = data.indicators;
          _stdCacheTime = now;
        }
      }
    } catch {
      // FastAPI unreachable — use hardcoded fallback
    }
  }
  dbIndicators = _stdCache || [];

  res.json({
    standard_indicators: dbIndicators.length > 0 ? dbIndicators : STANDARD_INDICATORS,
    user_indicators: userIndicators,
  });
});

export default router;
