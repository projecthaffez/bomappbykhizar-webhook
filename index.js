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
const ACTIVE_WINDOW_HOURS = 24;
const INSTANT_COOLDOWN_HOURS = 2;
const FALLBACK_COOLDOWN_HOURS = 6;
const FALLBACK_HOURS = [8, 16, 0]; // 8 AM, 4 PM, 12 AM

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

// ===== OPENAI PROMO GENERATOR =====
async function generateAIPromo(firstName) {
  if (!OPENAI_API_KEY) return `Hi ${firstName} 👋 Claim your bonus now!`;
  const prompt = `You are an expert short-campaign copywriter for online games and casinos.
Create one friendly, urgent, 1-sentence promo (max 25 words) including a bonus % (e.g. 150%, 200%) and name personalization.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write short, fun, persuasive casino promos." },
          { role: "user", content: `${prompt}\\nName: ${firstName}` }
        ],
        max_tokens: 60,
        temperature: 0.9
      })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text?.trim() || `Hi ${firstName} 👋 Claim your bonus now!`;
  } catch (err) {
    console.error("OpenAI error:", err);
    return `Hi ${firstName} 👋 Claim your bonus now!`;
  }
}

// ===== FACEBOOK SEND MESSAGE =====
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

// ===== FETCH ALL CONVERSATIONS (PAGINATION) =====
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

// ===== GET FIRST NAME (CACHE) =====
const nameCache = {};
async function getFirstName(id) {
  if (nameCache[id]) return nameCache[id];
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${id}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`);
    const d = await res.json();
    const name = d.first_name || "Player";
    nameCache[id] = name;
    return name;
  } catch {
    return "Player";
  }
}

// ===== MAIN AUTO-PROMO ROUTE =====
app.post("/auto-promo", async (req, res) => {
  if (req.body.secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  console.log("\\n📡 /auto-promo triggered");

  try {
    const now = Date.now();
    const activeWindow = ACTIVE_WINDOW_HOURS * 3600000;
    let users = readUsers();

    // Map for quick lookup
    const userMap = new Map(users.map(u => [u.id, u]));

    // Merge all conversations
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
        userMap.set(uid, { id: uid, lastSent: 0, lastActive: updated });
      }
    }
    users = Array.from(userMap.values());

    // Determine active users
    const activeUsers = users.filter(u => now - (u.lastActive || 0) <= activeWindow);
    let sent = 0;

    // 1️⃣ Instant promos
    for (const u of activeUsers) {
      if ((now - (u.lastSent || 0)) / 3600000 >= INSTANT_COOLDOWN_HOURS) {
        const name = await getFirstName(u.id);
        const msg = await generateAIPromo(name);
        await sendMessage(u.id, msg);
        u.lastSent = now;
        sent++;
        console.log(`📤 Sent instant promo → ${name}`);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // 2️⃣ Fallback promos
    const hr = new Date().getHours();
    if (FALLBACK_HOURS.includes(hr)) {
      console.log("🌙 Fallback window active — sending to inactive players");
      for (const u of users) {
        const isActive = now - (u.lastActive || 0) <= activeWindow;
        if (isActive) continue;
        if ((now - (u.lastSent || 0)) / 3600000 >= FALLBACK_COOLDOWN_HOURS) {
          const name = await getFirstName(u.id);
          const msg = await generateAIPromo(name);
          await sendMessage(u.id, msg);
          u.lastSent = now;
          sent++;
          console.log(`📤 Sent fallback promo → ${name}`);
          await new Promise(r => setTimeout(r, 150));
        }
      }
    }

    writeUsers(users);
    console.log(`✅ Auto-promo complete — sent:${sent}, active:${activeUsers.length}`);
    res.json({ sent, active: activeUsers.length });
  } catch (err) {
    console.error("❌ Error in /auto-promo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) => res.send("BomAppByKhizar AI Auto Promo v4.1 running fine ✅"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar AI Auto Promo v4.1 running on port ${PORT}`));
