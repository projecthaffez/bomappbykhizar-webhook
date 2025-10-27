import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { google } from "googleapis";
import cron from "node-cron"; // ✅ cron scheduler

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
let isPromoRunning = false;
let isOnlinePromoRunning = false;

// ===== CONSTANTS =====
const BONUS_LINE = "Signup Bonus 150%-200% | Regular Bonus 80%-100%";
const GAMES = [
  "Vblink", "Orion Stars", "Fire Kirin", "Milky Way", "Panda Master",
  "Juwa City", "Game Vault", "Ultra Panda", "Cash Machine",
  "Big Winner", "Game Room", "River Sweeps", "Mafia", "Yolo"
];
const EMOJIS = ["🎰", "🔥", "💎", "💰", "🎮", "⭐", "⚡", "🎯", "🏆", "💫"];

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
    if (j.error && j.error.code === 100) {
      console.log(`⚠️ Skipping invalid user ${id}`);
      return false;
    }
    if (j.error) console.error("FB API error:", j.error);
    return true;
  } catch (err) {
    console.error("Send message failed:", err);
    return false;
  }
}

// ===== AI PROMO MESSAGE =====
async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Don’t miss out", "Ends soon", "Hurry up", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, energetic Facebook casino promo message under 35 words.
Rules:
- Greet by name: Hi ${firstName} 👋
- Mention games: ${randomGames.join(", ")}
- Include: "${BONUS_LINE}"
- Add urgency: "${urgency}"
- End with: "Message us to unlock your bonus and see payment options 💳"
Tone: engaging, casino-style, use emojis like ${randomEmojis}.
`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], max_tokens: 80, temperature: 1 })
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ||
      `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  } catch {
    return `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  }
}

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
// 🇵🇰 You operate from Pakistan → 🇺🇸 Players are active at these times (converted to UTC)

// 8:00 AM PKT → 03:00 UTC → USA players' night (most active)
cron.schedule("0 3 * * *", () => triggerAutoOnlinePromo("🌙 US Night Players Promo (8AM PKT)"));

// 8:00 PM PKT → 15:00 UTC → USA players' morning (fresh start)
cron.schedule("0 15 * * *", () => triggerAutoOnlinePromo("🌅 US Morning Players Promo (8PM PKT)"));

// 12:00 AM PKT → 19:00 UTC → USA players' afternoon (lunch break)
cron.schedule("0 19 * * *", () => triggerAutoOnlinePromo("🌞 US Noon Players Promo (12AM PKT)"));

// ===== HEALTH CHECK =====
app.get("/", (req, res) =>
  res.send("BomAppByKhizar AI Auto Promo v5.3 — USA Player Timing Optimized ✅")
);

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar v5.3 running on port ${PORT}`));
