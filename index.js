import express from "express";
import fetch from "node-fetch";
import fs from "fs";
// Simple global flag to prevent double runs
let isPromoRunning = false;
const app = express();
app.use(express.json());

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";

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

// ===== FACEBOOK API HELPER =====
async function sendMessage(id, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "MESSAGE_TAG",
        tag: "ACCOUNT_UPDATE",
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

// ===== FETCH FB CONVERSATIONS =====
async function fetchAllConversations() {
  const all = [];
  let url = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fields=participants.limit(100){id,name},updated_time&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;
  while (url) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.data) all.push(...json.data);
    url = json.paging?.next || null;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ===== OPENAI MESSAGE GENERATOR =====
async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Don’t miss out", "Ends soon", "Hurry up", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, energetic and friendly Facebook Messenger casino promo (under 35 words).

Rules:
- Greet the user by name: Hi ${firstName} 👋
- Mention these games: ${randomGames.join(", ")}
- Include this bonus line: "${BONUS_LINE}"
- Add excitement and urgency: "${urgency}"
- Use emojis naturally like ${randomEmojis}
- End with: "Message us to unlock your bonus and see payment options 💳"
Tone: human, exciting, engaging, casino-themed.
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
      `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock your bonus 💳`
    );
  } catch (err) {
    console.error("OpenAI error:", err);
    return `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  }
}

// ===== USER SYNC =====
async function syncUsers() {
  const users = readUsers();
  const userMap = new Map(users.map(u => [u.id, u]));
  const convos = await fetchAllConversations();

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
    }
  }

  const merged = Array.from(userMap.values());
  writeUsers(merged);
  return merged;
}

// ===== AUTO PROMO ENDPOINT =====
app.post("/auto-promo", async (req, res) => {
  if (req.body.secret !== SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  console.log("📡 /auto-promo triggered");
  try {
    const users = await syncUsers();
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
    res.json({
  status: "✅ Promo run completed successfully",
  sent,
  skipped,
  total: users.length,
  message: "AI promo executed — shortened response for cron-job.org compatibility."
});

  } catch (err) {
    console.error("❌ Error in auto-promo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) =>
  res.send("BomAppByKhizar AI Auto Promo v4.3.2 Dynamic Edition ✅ Running Smoothly")
);
app.post("/sync-users", async (req, res) => {
  try {
    console.log("📡 /sync-users triggered at", new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
    console.log("🧾 Request body:", req.body);

    const { secret } = req.body;
    if (secret !== "khizarBulkKey123") {
      console.log("🚫 Unauthorized request — invalid secret");
      return res.status(403).json({ error: "Unauthorized" });
    }

    // ✅ Dummy successful response (no real sync)
    res.json({
      status: "✅ Sync Complete (Test Mode)",
      added: 0,
      total: 0
    });

  } catch (error) {
    console.error("❌ Sync failed:", error);
    res.status(500).json({ error: "Sync failed", details: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 BomAppByKhizar v4.3.2 running on port ${PORT}`)
);
