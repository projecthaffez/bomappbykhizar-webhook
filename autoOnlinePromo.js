import fs from "fs";
import fetch from "node-fetch";

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";

const BONUS_LINE = "Signup Bonus 150%-200% | Regular Bonus 80%-100%";
const GAMES = [
  "Vblink", "Orion Stars", "Fire Kirin", "Milky Way", "Panda Master",
  "Juwa City", "Game Vault", "Ultra Panda", "Cash Machine",
  "Big Winner", "Game Room", "River Sweeps", "Mafia", "Yolo"
];
const EMOJIS = ["🎰", "🔥", "💎", "💰", "🎮", "⭐", "⚡", "🎯", "🏆", "💫"];

function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    }
  } catch (err) {
    console.error("❌ Error reading users.json:", err);
  }
  return [];
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("❌ Error writing users.json:", err);
  }
}

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
      console.log(`⚠️ FB error for ${id}:`, j.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Send failed:", err);
    return false;
  }
}

async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Hurry up", "Ends soon", "Don’t miss out", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, exciting Facebook casino promo (under 35 words).
Say: Hi ${firstName} 👋
Mention games: ${randomGames.join(", ")}
Include bonus: "${BONUS_LINE}"
Add urgency: "${urgency}"
End with: "Message us to unlock your bonus 💳"
Use emojis like ${randomEmojis}.
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
    return data?.choices?.[0]?.message?.content?.trim() ||
      `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  } catch {
    return `Hi ${firstName} 👋 ${BONUS_LINE} 💰 Message us to unlock 💳`;
  }
}

async function main() {
  console.log("📡 AutoOnlinePromo started at", new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const users = readUsers();
  if (!users.length) return console.log("⚠️ No users found in users.json");

  const now = Date.now();
  const oneMinute = 1 * 60 * 1000;
  const sixtyMinutes = 60 * 60 * 1000;

  // Filter users active between 1 and 60 minutes ago
  const recentlyActive = users.filter(u => {
    const diff = now - u.lastActive;
    return diff >= oneMinute && diff <= sixtyMinutes;
  });

  // Sort by recent activity
  recentlyActive.sort((a, b) => b.lastActive - a.lastActive);

  // Max 5 promos per run
  const selected = recentlyActive.slice(0, 5);

  console.log(`🎯 Found ${recentlyActive.length} eligible users | Sending to: ${selected.length}`);

  if (!selected.length) return console.log("⚠️ No eligible users this round.");

  let sent = 0;
  for (const u of selected) {
    u.sentCount = u.sentCount || 0;
    if (u.sentCount >= 5) {
      console.log(`🚫 Skipping ${u.name || u.id} — already received 5 promos`);
      continue;
    }

    const msg = await generateMessage(u.name?.split(" ")[0] || "Player");
    console.log(`📩 Sending to ${u.name || u.id}: ${msg}`);
    const success = await sendMessage(u.id, msg);
    if (success) {
      u.sentCount++;
      u.lastSent = now;
      sent++;
    }
    await new Promise(r => setTimeout(r, 600)); // gentle delay
  }

  writeUsers(users);
  console.log(`✅ AutoOnlinePromo finished — Sent: ${sent} | Saved updates to users.json`);
}

main();
