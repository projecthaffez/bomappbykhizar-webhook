import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";

// ===== SETTINGS =====
const BONUS_LINE = "Signup Bonus 150%-200% | Regular Bonus 80%-100%";
const GAMES = [
  "Vblink", "Orion Stars", "Fire Kirin", "Milky Way", "Panda Master",
  "Juwa City", "Game Vault", "Ultra Panda", "Cash Machine",
  "Big Winner", "Game Room", "River Sweeps", "Mafia", "Yolo"
];

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

// ===== FACEBOOK API HELPERS =====
async function sendMessage(id, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id }, message: { text } })
    });
    const j = await res.json();
    if (j.error) console.error("FB API error:", j.error);
  } catch (err) {
    console.error("Send message failed:", err);
  }
}

async function fetchAllConversations() {
  const all = [];
  let url = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fields=participants.limit(100){id},updated_time&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;
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
  const prompt = `
You are a professional gaming marketer writing short Facebook Messenger re-engagement promos.

Include:
- Player name (e.g. "Hi ${firstName} 👋")
- Mention any 4–5 random games from this list:
${GAMES.join(", ")}
- Include this exact bonus line: "${BONUS_LINE}"
- Add urgency ("Ends soon", "Tonight only")
- End with CTA: "message us to unlock your bonus and see payment options 💳"
- Keep under 30 words
- No links, deposit terms or payment handles.
`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0.9
      })
    });
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim()
      || `Hi ${firstName} 👋 ${BONUS_LINE} — message us to unlock your bonus and see payment options 💳`;
  } catch (err) {
    console.error("OpenAI error:", err);
    return `Hi ${firstName} 👋 ${BONUS_LINE} — message us to unlock your bonus 💳`;
  }
}

// ===== SYNC USERS =====
async function syncUsers() {
  const users = readUsers();
  const userMap = new Map(users.map(u => [u.id, u]));
  const convos = await fetchAllConversations();
  for (const c of convos) {
    const updated = new Date(c.updated_time).getTime();
    const participant = c.participants?.data?.find(p => p.id !== PAGE_ID);
    if (!participant) continue;
    const uid = participant.id;
    const existing = userMap.get(uid);
    if (existing) {
      if (!existing.lastActive || updated > existing.lastActive) existing.lastActive = updated;
    } else {
      userMap.set(uid, { id: uid, lastActive: updated, lastSent: 0 });
    }
  }
  const merged = Array.from(userMap.values());
  writeUsers(merged);
  return merged;
}

// ===== MAIN ROUTE =====
app.post("/auto-promo", async (req, res) => {
  if (req.body.secret !== SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  console.log("📡 /auto-promo triggered");
  try {
    const users = await syncUsers();
    let sent = 0;
    for (const u of users) {
      const msg = await generateMessage();
      await sendMessage(u.id, msg);
      u.lastSent = Date.now();
      sent++;
      await new Promise(r => setTimeout(r, 200));
    }
    writeUsers(users);
    console.log(`✅ Sent ${sent} messages`);
    res.json({ sent, total: users.length });
  } catch (err) {
    console.error("❌ Error in auto-promo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HEALTH ROUTE =====
app.get("/", (req, res) => res.send("BomAppByKhizar AI Auto Promo v4.3 Pro Edition running fine ✅"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar v4.3 running on port ${PORT}`));
