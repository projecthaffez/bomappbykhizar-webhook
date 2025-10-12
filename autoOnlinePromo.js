import fetch from "node-fetch";
import fs from "fs";

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const USERS_FILE = "users.json";

// ===== CONSTANTS =====
const BONUS_LINE = "Signup Bonus 150%-200% | Regular Bonus 80%-100%";
const GAMES = [
  "Vblink", "Orion Stars", "Fire Kirin", "Milky Way", "Panda Master",
  "Juwa City", "Game Vault", "Ultra Panda", "Cash Machine",
  "Big Winner", "Game Room", "River Sweeps", "Mafia", "Yolo"
];
const EMOJIS = ["🎰", "🔥", "💎", "💰", "🎮", "⭐", "⚡", "🎯", "🏆", "💫"];

// ===== HELPERS =====
function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch (err) {
    console.error("❌ Error reading users.json", err);
  }
  return [];
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("❌ Error writing users.json", err);
  }
}

// ===== OPENAI MESSAGE GENERATOR =====
async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Ends soon", "Hurry up", "Don’t miss out", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, friendly and energetic casino promo (under 35 words).
Rules:
- Start with: Hi ${firstName} 👋
- Mention these games: ${randomGames.join(", ")}
- Include bonus info: "${BONUS_LINE}"
- Add urgency: "${urgency}"
- End with: "Message us to unlock your bonus and see payment options 💳"
Use emojis like ${randomEmojis} naturally.
Tone: human, exciting, engaging.
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

// ===== FACEBOOK MESSAGE SENDER =====
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
    if (j.error) {
      if (j.error.code === 100)
        console.log(`⚠️ Skipping invalid user ${id}`);
      else console.error("FB API error:", j.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ Send failed:", err);
    return false;
  }
}

// ===== AUTO ONLINE PROMO =====
async function runAutoOnlinePromo() {
  console.log("📡 AutoOnlinePromo triggered at:", new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));

  const users = readUsers();
  if (!users.length) return console.log("⚠️ No users found in users.json");

  let sent = 0, skipped = 0;
  const now = Date.now();

  for (const u of users) {
    // Check: active within 10 mins + not sent within last 3 hours
    if (now - u.lastActive < 10 * 60 * 1000 && now - u.lastSent > 3 * 60 * 60 * 1000) {
      const msg = await generateMessage(u.name?.split(" ")[0] || "Player");
      console.log(`📩 Promo → ${u.name || u.id}: ${msg}`);
      const success = await sendMessage(u.id, msg);
      if (success) {
        u.lastSent = now;
        sent++;
      } else skipped++;
      await new Promise(r => setTimeout(r, 400)); // slight delay between sends
    } else {
      skipped++;
    }
  }

  writeUsers(users);
  console.log(`✅ AutoOnlinePromo done — sent: ${sent} | skipped: ${skipped} | total: ${users.length}`);
}

// ===== RUN =====
runAutoOnlinePromo();
