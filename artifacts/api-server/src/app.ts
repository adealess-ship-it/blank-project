import http from "node:http";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const PYTRIGGER_ORIGIN = "http://localhost:8000";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // Allow onclick="..." attributes
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'", "https://*.replit.dev", "https://*.replit.app"],  // Allow Replit webview
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — whitelist origins
const ALLOWED_ORIGINS = [
  process.env["FRONTEND_URL"],
  "https://pystrategy.replit.app",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, true); // Allow for now but log
      logger.warn({ origin }, "CORS: unrecognized origin");
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/pytrigger/auth/login", authLimiter);
app.use("/pytrigger/auth/register", authLimiter);
app.use("/pytrigger/auth/forgot-password", authLimiter);

app.use("/pytrigger", (req: Request, res: Response) => {
  const target = new URL(
    "/pytrigger" + req.url,
    PYTRIGGER_ORIGIN,
  );

  const options: http.RequestOptions = {
    hostname: target.hostname,
    port: Number(target.port) || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers: {
      ...Object.fromEntries(
        Object.entries(req.headers).filter(
          ([k]) => !["cookie", "x-forwarded-for", "x-real-ip"].includes(k.toLowerCase()),
        ),
      ),
      host: target.host,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    logger.error({ err }, "Proxy error forwarding to pytrigger-api");
    if (!res.headersSent) {
      res.status(502).json({ error: "Upstream service unavailable" });
    }
  });

  req.pipe(proxyReq, { end: true });
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(express.static(path.join(__dirname, "../public")));

const sendPage = (filename: string) => (_req: Request, res: Response) =>
  res.sendFile(path.resolve(__dirname, "../public", filename));

app.get("/chart", sendPage("chart.html"));
app.get("/login", sendPage("login.html"));
app.get("/register", sendPage("register.html"));
app.get("/profile", sendPage("profile.html"));
app.get("/verify-email", sendPage("verify-email.html"));
app.get("/forgot-password", sendPage("forgot-password.html"));
app.get("/reset-password", sendPage("reset-password.html"));
app.get("/admin", sendPage("admin.html"));
app.get("/test-pyai", sendPage("test-pyai.html"));
app.get("/login-qr", sendPage("login-qr.html"));
app.get("/qr/verify/:token", sendPage("qr-verify.html"));
app.get("/account/qr-test", sendPage("qr-test.html"));
app.get("/account/indi-index", sendPage("indi-index.html"));
app.get("/account/admin-v2", sendPage("admin_v2.html"));
app.get("/account/admin-sales", sendPage("admin-sales.html"));
app.get("/account/leaderboard", sendPage("leaderboard.html"));
app.get("/account/indicator-builder", sendPage("indicator-builder.html"));
app.get("/account/marketplace", sendPage("indicator-marketplace.html"));
app.get("/account/backtest", sendPage("backtest.html"));
app.get("/account/backtest/history", sendPage("backtest-history.html"));
app.get("/account/wine", sendPage("wine.html"));
app.get("/account/receivedfile", sendPage("upload.html"));
app.get("/home/adminDev", sendPage("upload.html"));
app.get("/", sendPage("home.html"));

app.use("/api", router);

export default app;
