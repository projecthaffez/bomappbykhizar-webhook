import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { google } from "googleapis";
import cron from "node-cron";

const app = express();
app.use(express.json());

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";
const GOOGLE_KEY_BASE64 = process.env.GOOGLE_SERVICE_KEY_BASE64;
const GOOGLE_SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// ===== STATE FLAGS =====
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

// ===== GOOGLE SHEET BACKUP =====
async function backupToGoogleSheet(users) {
  try {
    if (!GOOGLE_KEY_BASE64 || !GOOGLE_SPREADSHEET_ID) {
      console.log("⚠️ Missing Google credentials. Skipping backup...");
      return;
    }

    console.log("🧾 Backing up users to Google Sheet...");
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

// ===== SYNC USERS =====
async function syncUsers() {
  console.log("📡 Sync started...");
  const users = readUsers();
  const userMap = new Map(users.map(u => [u.id, u]));
  const convos = []; // Placeholder for your fetchAllConversations() function call

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
  console.log(`✅ Sync complete — added: ${added}, total: ${merged.length}`);

  // 🧾 Save sync stats
  fs.writeFileSync("sync_stats.json", JSON.stringify({
    timestamp: new Date(),
    added,
    total: merged.length
  }, null, 2));

  return { added, total: merged.length };
}

// ===== /SYNC-USERS ENDPOINT =====
app.post("/sync-users", async (req, res) => {
  const { secret } = req.body;
  if (secret !== "khizarBulkKey123")
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const result = await syncUsers();
    res.json({ status: "✅ Sync Complete", ...result });
  } catch (error) {
    res.status(500).json({ error: "Sync failed", details: error.message });
  }
});

// ===== AUTO PROMO EXECUTION FUNCTION =====
async function triggerAutoOnlinePromo(label) {
  if (isOnlinePromoRunning) {
    console.log(`⚠️ ${label} skipped — already running`);
    return;
  }
  console.log(`🕒 [${label}] Triggering autoOnlinePromo.js...`);
  isOnlinePromoRunning = true;

  exec("node autoOnlinePromo.js", (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ ${label} failed:`, error.message);
    } else {
      console.log(`✅ ${label} completed successfully`);
      console.log(stdout);
    }
    isOnlinePromoRunning = false;
  });
}

// ===== AUTO PROMO CRON SCHEDULER (USA Player Timing) =====
cron.schedule("0 3 * * *", () => triggerAutoOnlinePromo("🌙 US Night Players Promo (8AM PKT)"));
cron.schedule("0 15 * * *", () => triggerAutoOnlinePromo("🌅 US Morning Players Promo (8PM PKT)"));
cron.schedule("0 19 * * *", () => triggerAutoOnlinePromo("🌞 US Noon Players Promo (12AM PKT)"));

// ===== API ENDPOINTS FOR STATS =====
app.get("/promo-stats", (req, res) => {
  if (!fs.existsSync("promo_stats.json"))
    return res.json({ sent: 0, failed: 0, lastRun: null });
  const stats = JSON.parse(fs.readFileSync("promo_stats.json", "utf8"));
  res.json(stats);
});

app.get("/sync-stats", (req, res) => {
  if (!fs.existsSync("sync_stats.json"))
    return res.json({ added: 0, total: 0, lastSync: null });
  const stats = JSON.parse(fs.readFileSync("sync_stats.json", "utf8"));
  res.json(stats);
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) =>
  res.send("BomAppByKhizar AI Auto Promo v5.4 — Stats Tracking + USA Timings ✅")
);

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar v5.4 running on port ${PORT}`));
