// server.js — FlexNet Backend
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import cookieParser from "cookie-parser";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Config ───────────────────────────────────────────
const DATA_DIR = "./data";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || null;
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "FLEXNET_SECRET_2025";
const SESSION_SECRET = process.env.SESSION_SECRET || "flexnet_session_" + crypto.randomBytes(16).toString("hex");
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────
function hashPassword(pwd) {
  return crypto.scryptSync(pwd, "flexnet_salt", 64).toString("hex");
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// In-memory session store (restart resets sessions — fine for single instance)
const sessions = new Map();

function requireAuth(req, res, next) {
  const token = req.cookies?.flexnet_session || req.headers.authorization?.replace("Bearer ", "");
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.sessionUser = sessions.get(token);
  next();
}

// ─── Serve static frontend ───────────────────────────
app.use(express.static(path.join(process.cwd(), "public")));

// ─── Admin: Login ─────────────────────────────────────
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (username !== ADMIN_USER) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const expectedHash = ADMIN_PASS_HASH || hashPassword("changeme");
  const inputHash = hashPassword(password);
  if (inputHash !== expectedHash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = makeSessionToken();
  sessions.set(token, username);
  res.cookie("flexnet_session", token, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: "strict"
  });
  res.json({ status: "ok" });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.cookies?.flexnet_session;
  if (token) sessions.delete(token);
  res.clearCookie("flexnet_session");
  res.json({ status: "ok" });
});

app.get("/api/admin/check", (req, res) => {
  const token = req.cookies?.flexnet_session;
  if (token && sessions.has(token)) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// ─── Admin: List submissions ─────────────────────────
app.get("/api/admin/submissions", requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith(".csv"))
      .sort((a, b) => fs.statSync(path.join(DATA_DIR, b)).mtimeMs - fs.statSync(path.join(DATA_DIR, a)).mtimeMs)
      .map(f => {
        const stat = fs.statSync(path.join(DATA_DIR, f));
        return {
          filename: f,
          size: stat.size,
          created: stat.mtime.toISOString(),
          subjectId: f.replace("FlexNet_", "").replace(/_\d+\.csv$/, "")
        };
      });
    res.json({ total: files.length, submissions: files });
  } catch (e) {
    res.status(500).json({ error: "Failed to list files" });
  }
});

// ─── Admin: Download single CSV ──────────────────────
app.get("/api/admin/download/:filename", requireAuth, (req, res) => {
  const fname = req.params.filename;
  // Security: only allow .csv files, no path traversal
  if (!fname.endsWith(".csv") || fname.includes("..") || fname.includes("/")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const fpath = path.join(DATA_DIR, fname);
  if (!fs.existsSync(fpath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(fpath);
});

// ─── Admin: Download all as merged CSV ────────────────
app.get("/api/admin/download-all", requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".csv"));
    if (files.length === 0) {
      return res.status(404).json({ error: "No data files" });
    }
    // Merge all CSVs: take header from first file, skip header from rest
    let merged = "";
    files.forEach((f, i) => {
      const content = fs.readFileSync(path.join(DATA_DIR, f), "utf-8");
      const lines = content.trim().split("\n");
      if (i === 0) {
        merged += content.trim() + "\n";
      } else {
        merged += lines.slice(1).join("\n") + "\n";
      }
    });
    const outName = `FlexNet_all_${Date.now()}.csv`;
    const outPath = path.join(DATA_DIR, outName);
    fs.writeFileSync(outPath, merged);
    res.download(outPath, "FlexNet_all_merged.csv", () => {
      fs.unlinkSync(outPath);
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to merge files" });
  }
});

// ─── Admin: Delete a submission ──────────────────────
app.delete("/api/admin/submissions/:filename", requireAuth, (req, res) => {
  const fname = req.params.filename;
  if (!fname.endsWith(".csv") || fname.includes("..") || fname.includes("/")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const fpath = path.join(DATA_DIR, fname);
  if (!fs.existsSync(fpath)) {
    return res.status(404).json({ error: "File not found" });
  }
  fs.unlinkSync(fpath);
  res.json({ status: "deleted", filename: fname });
});

// ─── Experiment: Upload data ──────────────────────────
app.post("/api/upload", (req, res) => {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${UPLOAD_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { subjectId, payload_csv, payload_json } = req.body;

  if (!subjectId || !payload_csv) {
    return res.status(400).json({ error: "Missing subjectId or payload_csv" });
  }

  // Save CSV
  const ts = Date.now();
  const csvName = `FlexNet_${subjectId}_${ts}.csv`;
  fs.writeFileSync(path.join(DATA_DIR, csvName), payload_csv);

  // Save JSON (full trial data for analysis)
  if (payload_json) {
    const jsonName = `FlexNet_${subjectId}_${ts}.json`;
    fs.writeFileSync(path.join(DATA_DIR, jsonName), JSON.stringify(payload_json, null, 2));
  }

  console.log(`[${new Date().toISOString()}] Saved: ${csvName}`);
  res.json({ status: "ok", subjectId });
});

// ─── Fallback ─────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// ─── Start ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FlexNet backend running on port ${PORT}`);
  if (!ADMIN_PASS_HASH) {
    console.log(`⚠️  No ADMIN_PASS_HASH set. Default: admin / changeme`);
    console.log(`   Generate hash: node -e "const c=require('crypto'); console.log(c.scryptSync('YOUR_PASSWORD','flexnet_salt',64).toString('hex'))"`);
  }
});
