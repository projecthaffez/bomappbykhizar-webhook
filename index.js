import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { google } from "googleapis";
import cron from "node-cron";

const app = express();

// ===== ENABLE CORS (for frontend connection) =====
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const USERS_FILE = "users.json";
const GOOGLE_KEY_BASE64 = process.env.GOOGLE_SERVICE_KEY_BASE64;
const GOOGLE_SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const PAUSE_FILE = "promo.paused";
const PROMO_STATS_FILE = "promo_stats.json";

let isOnlinePromoRunning = false;

// ===== FILE HELPERS =====
function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Error reading users.json", err);
  }
  return [];
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Error writing users.json", err);
  }
}

// ===== PAUSE/RESUME HELPERS =====
function isPromoPaused() { return fs.existsSync(PAUSE_FILE); }
function pausePromo() { fs.writeFileSync(PAUSE_FILE, "1"); }
function resumePromo() { if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE); }

// ===== GOOGLE SHEET BACKUP =====
async function backupToGoogleSheet(users) {
  try {
    if (!GOOGLE_KEY_BASE64 || !GOOGLE_SPREADSHEET_ID) {
      console.log("⚠️ Missing Google credentials. Skipping backup...");
      return;
    }

    const serviceKey = JSON.parse(Buffer.from(GOOGLE_KEY_BASE64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials: serviceKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    const sheets = google.sheets({ version: "v4", auth });

    const values = [["ID", "Name", "Last Active", "Last Sent"]].concat(
      users.map(u => [
        u.id,
        u.name,
        new Date(u.lastActive).toLocaleString("en-US", { timeZone: "Asia/Karachi" }),
        new Date(u.lastSent).toLocaleString("en-US", { timeZone: "Asia/Karachi" })
      ])
    );

    await sheets.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: "Sheet1!A:Z"
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values }
    });

    console.log(`✅ Google Sheet updated — ${users.length} users saved`);
  } catch (err) {
    console.error("❌ Google Sheet backup failed:", err);
  }
}
// ===== DEBUG USERS CHECK (temporary) =====
app.get("/debug/users", (req, res) => {
  try {
    if (fs.existsSync("users.json")) {
      const data = JSON.parse(fs.readFileSync("users.json", "utf8"));
      res.json({ count: data.length, sample: data.slice(0, 5) });
    } else {
      res.json({ count: 0, message: "users.json file not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to read users.json", details: err.message });
  }
});

// ===== SYNC USERS =====
async function syncUsers() {
  console.log("📡 Sync started...");
  const users = readUsers();
  const userMap = new Map(users.map(u => [u.id, u]));
  const convos = [];
  let added = 0;

  for (const c of convos) {
    const updated = new Date(c.updated_time).getTime();
    const participant = c.participants?.data?.find(p => p.id !== PAGE_ID);
    if (!participant) continue;
    const uid = participant.id;
    const name = participant.name || "Player";
    const existing = userMap.get(uid);

    if (existing) {
      if (!existing.lastActive || updated > existing.lastActive)
        existing.lastActive = updated;
      existing.name = name;
    } else {
      userMap.set(uid, { id: uid, name, lastActive: updated, lastSent: 0 });
      added++;
    }
  }

  const merged = Array.from(userMap.values());
  writeUsers(merged);
  await backupToGoogleSheet(merged);
  fs.writeFileSync("sync_stats.json", JSON.stringify({ timestamp: new Date(), added, total: merged.length }, null, 2));
  return { added, total: merged.length };
}

// ===== API ENDPOINTS =====
app.post("/sync-users", async (req, res) => {
  const { secret } = req.body;
  if (secret !== SECRET) return res.status(403).json({ error: "Unauthorized" });
  try {
    const result = await syncUsers();
    res.json({ status: "✅ Sync Complete", ...result });
  } catch (error) {
    res.status(500).json({ error: "Sync failed", details: error.message });
  }
});

// ===== MANUAL PROMO =====
app.post("/manual-promo", async (req, res) => {
  const { secret, message, target = "recent" } = req.body;
  if (secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  if (!message) return res.status(400).json({ error: "Message required" });
  if (isPromoPaused()) return res.status(423).json({ error: "Promo system paused" });

  const users = readUsers();
  const now = Date.now();
  let selected = users;

  if (target === "recent") selected = users.filter(u => now - (u.lastActive || 0) <= 60 * 60 * 1000);
  selected = selected.slice(0, 200);

  let sent = 0, skipped = 0, failed = 0;
  for (const u of selected) {
    if (u.lastSent && (now - u.lastSent < 30 * 60 * 1000)) { skipped++; continue; }
    const msg = `Hi ${u.name || "Player"} 👋 ${message}`;
    const success = await sendMessage(u.id, msg);
    if (success) { u.lastSent = Date.now(); sent++; } else failed++;
    await new Promise(r => setTimeout(r, 400));
  }

  writeUsers(users);

  // ✅ Save promo stats
  fs.writeFileSync(PROMO_STATS_FILE, JSON.stringify({
    sent,
    skipped,
    failed,
    lastRun: new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" })
  }, null, 2));

  res.json({ sent, skipped, failed });
});

// ===== PROMO STATS ENDPOINT =====
app.get("/promo-stats", (req, res) => {
  try {
    if (fs.existsSync(PROMO_STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(PROMO_STATS_FILE, "utf8"));
      return res.json(stats);
    }
    res.json({ sent: 0, skipped: 0, failed: 0, lastRun: "Never" });
  } catch (err) {
    console.error("Error reading promo_stats.json:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// ===== FACEBOOK MESSAGE SENDER =====
async function sendMessage(id, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "MESSAGE_TAG",
        tag: "EVENT_REMINDER",
        recipient: { id },
        message: { text }
      })
    });
    const j = await res.json();
    if (j.error && j.error.code === 100) return false;
    return true;
  } catch {
    return false;
  }
}

// ===== CRON JOBS =====
cron.schedule("0 3 * * *", () => triggerAutoOnlinePromo("🌙 US Night Promo (8AM PKT)"));
cron.schedule("0 15 * * *", () => triggerAutoOnlinePromo("🌅 US Morning Promo (8PM PKT)"));
cron.schedule("0 19 * * *", () => triggerAutoOnlinePromo("🌞 US Noon Promo (12AM PKT)"));

async function triggerAutoOnlinePromo(label) {
  if (isOnlinePromoRunning) return;
  if (isPromoPaused()) return;
  console.log(`🕒 [${label}] Triggering autoOnlinePromo.js...`);
  isOnlinePromoRunning = true;
  exec("node autoOnlinePromo.js", () => { isOnlinePromoRunning = false; });
}

// ===== STATUS & CONTROLS =====
app.post("/promo/pause", (req, res) => {
  const { secret } = req.body;
  if (secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  pausePromo(); res.json({ status: "paused" });
});
app.post("/promo/resume", (req, res) => {
  const { secret } = req.body;
  if (secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  resumePromo(); res.json({ status: "running" });
});
app.get("/promo/status", (req, res) => res.json({ paused: isPromoPaused(), running: !isPromoPaused(), isOnlinePromoRunning }));

// ===== AI MESSAGE PREVIEW =====
app.get("/ai-preview", (req, res) => {
  res.json({
    message: "Hi Player 👋 Signup Bonus 150%-200% | Regular Bonus 80%-100%! 💰 Message us to unlock your bonus 💳"
  });
});

// ===== PRIVACY POLICY & DATA DELETION =====
app.get("/privacy-policy", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`
    <html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;">
    <h1>Privacy Policy - BomAppByKhizar</h1>
    <p>We respect your privacy and do not permanently store any personal information.</p>
    <p>Your Facebook ID and name are used only to send messages through the Messenger platform.</p>
    <p>For deletion requests, visit <a href="/delete-data">our deletion page</a>.</p>
    </body></html>
  `);
});

app.get("/delete-data", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`
    <html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;">
    <h1>Data Deletion Request - BomAppByKhizar</h1>
    <p>If you wish to delete your data, please email <b>khizarhz@yahoo.com</b> with your Facebook ID.</p>
    <p>Your data will be deleted within 48 hours.</p>
    </body></html>
  `);
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) => res.send("🚀 BomAppByKhizar v7.2 — Stats + Privacy + Promo Ready ✅"));

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar v7.2 running on port ${PORT}`));
