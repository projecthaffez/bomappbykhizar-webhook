import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";

const app = express();
app.use(express.json());

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";

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

// ===== FACEBOOK MESSAGE SENDER =====
async function sendMessage(id, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "MESSAGE_TAG",
        tag: "ACCOUNT_UPDATE", // ✅ safer and approved for re-engagement
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

// ===== FETCH FB CONVERSATIONS (FULL PAGINATION FIX) =====
async function fetchAllConversations() {
  const all = [];
  let page = 1;
  let url = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fields=participants.limit(100){id,name},updated_time&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;

  console.log("📡 Starting full Facebook sync...");

  while (url) {
    try {
      const res = await fetch(url);
      const json = await res.json();

      if (json.error) {
        console.error(`❌ FB API error on page ${page}:`, json.error);
        break;
      }

      if (json.data && json.data.length > 0) {
        all.push(...json.data);
        console.log(`📦 Page ${page}: fetched ${json.data.length} — total ${all.length}`);
      } else {
        console.log(`⚠️ Page ${page}: no data, stopping.`);
        break;
      }

      // pagination move
      url = json.paging?.next || null;
      page++;

      // safety delay for rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error("❌ Pagination fetch failed:", err);
      break;
    }
  }

  console.log(`✅ Completed fetching ${all.length} conversations`);
  return all;
}

// ===== AI PROMO MESSAGE =====
async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Don’t miss out", "Ends soon", "Hurry up", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, energetic Facebook casino promo message under 35 words.
- Greet by name: Hi ${firstName} 👋
- Mention games: ${randomGames.join(", ")}
- Include: "${BONUS_LINE}"
- Add urgency: "${urgency}"
- End with: "Message us to unlock your bonus and see payment options 💳"
Tone: human, exciting, casino-style, use emojis like ${randomEmojis}.
`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 1
      })
    });
    const data = await res.json();
    return (
      data?.choices?.[0]?.message?.content?.trim() ||
      `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`
    );
  } catch (err) {
    console.error("OpenAI error:", err);
    return `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  }
}

// ===== SYNC USERS =====
async function syncUsers() {
  console.log("📡 Sync started...");
  const users = readUsers();
  const userMap = new Map(users.map(u => [u.id, u]));
  const convos = await fetchAllConversations();

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
  console.log(`✅ Sync complete — added: ${added}, total: ${merged.length}`);
  return { added, total: merged.length };
}

// ===== /SYNC-USERS ENDPOINT =====
app.post("/sync-users", async (req, res) => {
  console.log("📡 /sync-users triggered at", new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const { secret } = req.body;
  if (secret !== "khizarBulkKey123") {
    console.log("🚫 Unauthorized request — invalid secret");
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const result = await syncUsers();
    res.json({
      status: "✅ Sync Complete",
      added: result.added,
      total: result.total,
    });
  } catch (error) {
    console.error("❌ Sync failed:", error);
    res.status(500).json({ error: "Sync failed", details: error.message });
  }
});

// ===== AUTO PROMO =====
app.post("/auto-promo", async (req, res) => {
  if (req.body.secret !== SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  if (isPromoRunning) {
    console.log("⚠️ Promo already running — skipping new trigger");
    return res.status(429).json({ error: "Promo already in progress" });
  }

  isPromoRunning = true;
  console.log("📡 /auto-promo triggered");

  try {
    const users = readUsers();
    let sent = 0, skipped = 0;

    for (const u of users) {
      const msg = await generateMessage(u.name?.split(" ")[0] || "Player");
      console.log(`📩 Promo for ${u.name || u.id}: ${msg}`);
      const success = await sendMessage(u.id, msg);
      if (success) {
        u.lastSent = Date.now();
        sent++;
      } else skipped++;
      await new Promise(r => setTimeout(r, 400));
    }

    writeUsers(users);
    console.log(`✅ Sent ${sent} | ⚠️ Skipped ${skipped}`);
    res.json({ status: "✅ Promo run completed successfully", sent, skipped, total: users.length });
  } catch (err) {
    console.error("❌ Error in auto-promo:", err);
    res.status(500).json({ error: err.message });
  } finally {
    isPromoRunning = false;
  }
});

// ===== AUTO ONLINE PROMO =====
app.post("/auto-online-promo", (req, res) => {
  const { secret } = req.body;
  if (secret !== "khizarBulkKey123")
    return res.status(401).json({ error: "Unauthorized" });

  if (isOnlinePromoRunning) {
    console.log("⚠️ Online Promo already running — skipping new trigger");
    return res.status(429).json({ error: "Online Promo already in progress" });
  }

  isOnlinePromoRunning = true;
  console.log("📡 /auto-online-promo triggered externally");

  exec("node autoOnlinePromo.js", (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Exec error: ${error}`);
      isOnlinePromoRunning = false;
      return res.status(500).json({ error: error.message });
    }
    console.log(stdout);
    isOnlinePromoRunning = false;
    res.json({ status: "✅ AutoOnlinePromo executed successfully" });
  });
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) =>
  res.send("BomAppByKhizar AI Auto Promo v4.3.5 — Full Sync Fix ✅ Running Smoothly")
);

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 BomAppByKhizar v4.3.5 running on port ${PORT}`)
);
