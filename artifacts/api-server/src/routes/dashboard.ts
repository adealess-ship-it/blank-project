import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { Router, type Request, type Response } from "express";

const router = Router();

const QA_DIR = path.join(os.homedir(), "workspace/qa-core-testing-hub/test-results");
const QA_RESULTS_DIR = path.join(os.homedir(), "workspace/qa_results");
const UPLOAD_DIR = path.resolve(__dirname, "../../../../qa_results/uploads");

// GET /dashboard/sessions — Claude Code sessions (live PID check)
router.get("/dashboard/sessions", (_req: Request, res: Response) => {
  try {
    const sessFile = path.join(os.homedir(), "workspace/.claude_sessions.json");
    if (!fs.existsSync(sessFile)) {
      // Fallback: scan /proc for claude processes
      const procs: any[] = [];
      try {
        // lstart has 5 tokens: "Day Mon DD HH:MM:SS YYYY"
        const out = execSync("ps -eo pid,lstart,rss,pcpu,cmd 2>/dev/null | grep -v grep", {
          timeout: 3000,
        }).toString().trim();
        for (const line of out.split("\n").filter(Boolean)) {
          // pid(1) + lstart(5 tokens) + rss(1) + pcpu(1) + cmd(rest)
          const m = line.match(/^\s*(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
          if (!m) continue;
          const cmd = m[5].trim();
          // Only match actual Claude Code processes (cmd is exactly "claude" or ends with /claude)
          if (cmd !== "claude" && !cmd.match(/\/claude(\s|$)/)) continue;
          procs.push({
            pid: Number(m[1]),
            start: m[2].trim(),
            mem_kb: Number(m[3]),
            cpu: Number(m[4]),
            cmd,
            alive: true,
          });
        }
      } catch { /* no claude procs */ }
      res.json({ sessions: procs, source: "proc" });
      return;
    }
    const lines = fs.readFileSync(sessFile, "utf8").trim().split("\n").filter(Boolean);
    const sessions = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter((s: any) => {
        try { fs.accessSync(`/proc/${s.pid}`); return true; } catch { return false; }
      });
    res.json({ sessions, source: "file" });
  } catch {
    res.json({ sessions: [], source: "error" });
  }
});

// GET /dashboard/system — system stats
router.get("/dashboard/system", (_req: Request, res: Response) => {
  try {
    const mem = (() => {
      try {
        const out = execSync("free -b 2>/dev/null", { timeout: 3000 }).toString();
        const line = out.split("\n").find((l) => l.startsWith("Mem:"));
        if (!line) return null;
        const parts = line.split(/\s+/);
        return { total: Number(parts[1]), used: Number(parts[2]), free: Number(parts[3]) };
      } catch { return null; }
    })();

    const disk = (() => {
      try {
        const out = execSync("df -B1 ~/workspace 2>/dev/null | tail -1", { timeout: 3000 }).toString().trim();
        const parts = out.split(/\s+/);
        return { total: Number(parts[1]), used: Number(parts[2]), avail: Number(parts[3]) };
      } catch { return null; }
    })();

    const gitInfo = (() => {
      try {
        const branch = execSync("git -C ~/workspace branch --show-current 2>/dev/null", { timeout: 3000 }).toString().trim();
        const lastCommit = execSync("git -C ~/workspace log --oneline -1 2>/dev/null", { timeout: 3000 }).toString().trim();
        const todayCount = execSync('git -C ~/workspace log --oneline --since="midnight" 2>/dev/null | wc -l', { timeout: 3000 }).toString().trim();
        return { branch, lastCommit, todayCommits: Number(todayCount) };
      } catch { return null; }
    })();

    const services = (() => {
      const result: Record<string, string> = {};
      try {
        const out = execSync("ps -eo cmd --no-headers 2>/dev/null", { timeout: 3000 }).toString();
        result.express = out.includes("dist/index.mjs") ? "running" : "stopped";
        result.uvicorn = out.includes("uvicorn") ? "running" : "stopped";
        result.vite = out.includes("vite") ? "running" : "stopped";
      } catch {
        result.express = "unknown";
        result.uvicorn = "unknown";
      }
      return result;
    })();

    res.json({ mem, disk, git: gitInfo, services, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/files — QA screenshots + uploads
router.get("/dashboard/files", (_req: Request, res: Response) => {
  try {
    const files: any[] = [];

    // QA results latest screenshots
    const latestDir = path.join(QA_RESULTS_DIR, "latest");
    if (fs.existsSync(latestDir)) {
      for (const f of fs.readdirSync(latestDir)) {
        if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
        const fp = path.join(latestDir, f);
        const stat = fs.statSync(fp);
        files.push({
          name: f,
          path: fp,
          source: "qa-latest",
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    // QA results pages screenshots
    const pagesDir = path.join(QA_RESULTS_DIR, "pages");
    if (fs.existsSync(pagesDir)) {
      for (const f of fs.readdirSync(pagesDir)) {
        if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
        const fp = path.join(pagesDir, f);
        const stat = fs.statSync(fp);
        files.push({
          name: f,
          path: fp,
          source: "qa-pages",
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    // Stress test screenshots (latest run only)
    if (fs.existsSync(QA_DIR)) {
      const runs = fs.readdirSync(QA_DIR).filter((d) => d.startsWith("stress-")).sort().reverse();
      if (runs.length > 0) {
        const ssDir = path.join(QA_DIR, runs[0], "screenshots");
        if (fs.existsSync(ssDir)) {
          for (const f of fs.readdirSync(ssDir)) {
            if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
            const fp = path.join(ssDir, f);
            const stat = fs.statSync(fp);
            files.push({
              name: f,
              path: fp,
              source: `stress-${runs[0]}`,
              size: stat.size,
              modified: stat.mtime.toISOString(),
            });
          }
        }
      }
    }

    // Uploaded files
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (!/\.(png|jpg|jpeg|gif|webp|bmp|svg|md)$/i.test(f)) continue;
        const fp = path.join(UPLOAD_DIR, f);
        const stat = fs.statSync(fp);
        files.push({
          name: f,
          path: fp,
          source: "upload",
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    res.json({ files, total: files.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/files/preview/:source/:filename — serve screenshot image
router.get("/dashboard/files/preview/:source/:filename", (req: Request, res: Response) => {
  const { source, filename } = req.params as { source: string; filename: string };
  const safeName = path.basename(filename as string);

  let dir = "";
  if (source === "qa-latest") dir = path.join(QA_RESULTS_DIR, "latest");
  else if (source === "qa-pages") dir = path.join(QA_RESULTS_DIR, "pages");
  else if (source === "upload") dir = UPLOAD_DIR;
  else if ((source as string).startsWith("stress-")) {
    const run = (source as string).replace("stress-", "");
    dir = path.join(QA_DIR, run, "screenshots");
  }

  if (!dir) { res.status(404).json({ error: "unknown source" }); return; }

  const fp = path.join(dir, safeName);
  if (!fs.existsSync(fp)) { res.status(404).json({ error: "not found" }); return; }

  res.sendFile(fp);
});

// GET /dashboard/github — latest GitHub Actions runs
router.get("/dashboard/github", async (_req: Request, res: Response) => {
  try {
    const token = process.env["GITHUB_TOKEN"];
    if (!token) { res.json({ runs: [], error: "no GITHUB_TOKEN" }); return; }

    const resp = await fetch(
      "https://api.github.com/repos/adealess-ship-it/pystrategy/actions/runs?per_page=10",
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } },
    );
    if (!resp.ok) { res.json({ runs: [], error: `github ${resp.status}` }); return; }

    const data = (await resp.json()) as any;
    const runs = (data.workflow_runs || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      created: r.created_at,
      url: r.html_url,
      branch: r.head_branch,
    }));
    res.json({ runs });
  } catch (err: any) {
    res.json({ runs: [], error: err.message });
  }
});

// GET /dashboard/activity — commit & screenshot counts per 6-hour slot (7 days)
router.get("/dashboard/activity", (_req: Request, res: Response) => {
  try {
    const workDir = path.join(os.homedir(), "workspace");

    // Git commits bucketed by 6h
    let commitLines: string[] = [];
    try {
      commitLines = execSync(
        `git -C ${workDir} log --format="%ci" --since="7 days ago" 2>/dev/null`,
      ).toString().trim().split("\n").filter(Boolean);
    } catch { /* no git or no commits */ }

    const commitBuckets: Record<string, number> = {};
    for (const line of commitLines) {
      const d = new Date(line);
      if (isNaN(d.getTime())) continue;
      const slot = new Date(d);
      slot.setMinutes(0, 0, 0);
      slot.setHours(Math.floor(d.getHours() / 6) * 6);
      const key = slot.toISOString();
      commitBuckets[key] = (commitBuckets[key] || 0) + 1;
    }

    // Screenshot counts bucketed by 6h (mtime of .png files)
    const ssBuckets: Record<string, number> = {};
    const scanDirs = [
      path.join(QA_RESULTS_DIR, "latest"),
      path.join(QA_RESULTS_DIR, "pages"),
      UPLOAD_DIR,
    ];
    // Add latest stress dir
    if (fs.existsSync(QA_DIR)) {
      const runs = fs.readdirSync(QA_DIR).filter((d) => d.startsWith("stress-")).sort().reverse();
      if (runs.length > 0) {
        scanDirs.push(path.join(QA_DIR, runs[0], "screenshots"));
      }
    }
    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
        try {
          const st = fs.statSync(path.join(dir, f));
          const d = st.mtime;
          const slot = new Date(d);
          slot.setMinutes(0, 0, 0);
          slot.setHours(Math.floor(d.getHours() / 6) * 6);
          const key = slot.toISOString();
          ssBuckets[key] = (ssBuckets[key] || 0) + 1;
        } catch { /* skip */ }
      }
    }

    // Generate last 28 slots (7 days x 4 per day)
    const now = new Date();
    const baseHour = Math.floor(now.getHours() / 6) * 6;
    const slots = [];
    for (let i = 27; i >= 0; i--) {
      const t = new Date(now);
      t.setMinutes(0, 0, 0);
      t.setHours(baseHour - i * 6);
      const key = t.toISOString();
      slots.push({
        time: key,
        label: t.toLocaleDateString("th-TH", { month: "short", day: "numeric" }) + " " + t.getHours() + ":00",
        commits: commitBuckets[key] || 0,
        screenshots: ssBuckets[key] || 0,
      });
    }

    res.json({ slots });
  } catch (err: any) {
    res.json({ slots: [], error: err.message });
  }
});

// ── System History (CPU/RAM snapshots every 60s, keep 24h) ──
interface SysSnapshot { time: string; cpu: number; ram_pct: number; ram_used: number; }
const _sysHistory: SysSnapshot[] = [];
const MAX_SYS_HISTORY = 10080; // 7 days at 60s intervals

// Wait time log: job durations per type
interface WaitEntry { time: string; type: string; duration: number; }
const _waitLog: WaitEntry[] = [];
const MAX_WAIT_LOG = 5000;

function collectSysSnapshot() {
  try {
    const cpuOut = execSync("grep 'cpu ' /proc/stat", { timeout: 1000 }).toString().trim();
    const parts = cpuOut.split(/\s+/).slice(1).map(Number);
    const idle = parts[3];
    const total = parts.reduce((a, b) => a + b, 0);

    const memOut = execSync("free -b 2>/dev/null", { timeout: 1000 }).toString();
    const memLine = memOut.split("\n").find((l) => l.startsWith("Mem:"));
    const memParts = memLine ? memLine.split(/\s+/) : [];
    const memTotal = Number(memParts[1]) || 1;
    const memUsed = Number(memParts[2]) || 0;

    const snap: SysSnapshot = {
      time: new Date().toISOString(),
      cpu: 0,
      ram_pct: Math.round(memUsed / memTotal * 100),
      ram_used: Math.round(memUsed / 1073741824 * 10) / 10,
    };

    if (_sysHistory.length > 0) {
      const prevSnap = (_sysHistory as any).__prevStat;
      if (prevSnap) {
        const dTotal = total - prevSnap.total;
        const dIdle = idle - prevSnap.idle;
        snap.cpu = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;
      }
    }
    ((_sysHistory as any).__prevStat) = { total, idle };

    _sysHistory.push(snap);
    if (_sysHistory.length > MAX_SYS_HISTORY) _sysHistory.shift();
  } catch { /* skip */ }
}

setInterval(collectSysSnapshot, 60_000);
collectSysSnapshot();

router.get("/dashboard/sys-history", (_req: Request, res: Response) => {
  const hours = Math.min(Number(_req.query["hours"]) || 1, 168);
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const filtered = _sysHistory.filter((s) => s.time >= cutoff);
  res.json({ snapshots: filtered, total: _sysHistory.length, hours });
});

// POST /dashboard/wait-log — called by Python backtest when job completes
router.post("/dashboard/wait-log", (req: Request, res: Response) => {
  const { type, duration } = req.body || {};
  if (type && typeof duration === "number") {
    _waitLog.push({ time: new Date().toISOString(), type, duration: Math.round(duration * 10) / 10 });
    if (_waitLog.length > MAX_WAIT_LOG) _waitLog.shift();
  }
  res.json({ ok: true });
});

// GET /dashboard/wait-history
router.get("/dashboard/wait-history", (_req: Request, res: Response) => {
  const hours = Math.min(Number(_req.query["hours"]) || 1, 168);
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const filtered = _waitLog.filter((w) => w.time >= cutoff);
  res.json({ entries: filtered, total: _waitLog.length });
});

export default router;
