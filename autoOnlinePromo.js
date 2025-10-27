import fetch from "node-fetch";
import fs from "fs";

// ===== CONFIG =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USERS_FILE = "users.json";
const PAUSE_FILE = "promo.paused"; // ✅ Pause flag file

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

function isPaused() {
  return fs.existsSync(PAUSE_FILE);
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
        tag: "ACCOUNT_UPDATE", // ✅ Safe re-engagement tag
        recipient: { id },
        message: { text }
      })
    });
    const j = await res.json();
    if (j.error && j.error.code === 100) {
      console.log(`⚠️ Invalid user ${id} — skipping`);
      return false;
    }
    if (j.error) {
      console.error("FB API error:", j.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ Send message failed:", err);
    return false;
  }
}

// ===== AI MESSAGE GENERATOR =====
async function generateMessage(firstName = "Player") {
  const randomGames = GAMES.sort(() => 0.5 - Math.random()).slice(0, 5);
  const randomEmojis = EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3).join(" ");
  const urgency = ["Tonight only", "Don’t miss out", "Ends soon", "Hurry up", "Limited time"][Math.floor(Math.random() * 5)];

  const prompt = `
Create a short, exciting casino promo (under 35 words).
- Start: Hi ${firstName} 👋
- Mention: ${randomGames.join(", ")}
- Include bonus info: "${BONUS_LINE}"
- Add urgency: "${urgency}"
- Emojis: ${randomEmojis}
- End: "Message us to unlock your bonus 💳"
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
    console.error("❌ OpenAI error:", err);
    return `Hi ${firstName} 👋 ${BONUS_LINE} ${randomEmojis} Message us to unlock 💳`;
  }
}

// ===== AUTO SYNC FALLBACK =====
async function autoSyncIfEmpty() {
  let users = readUsers();

  if (!users.length) {
    console.log("⚠️ users.json empty — running auto-sync before promo...");
    try {
      const url = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fields=participants.limit(100){id,name},updated_time&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.data) {
        const freshUsers = json.data.map(c => {
          const participant = c.participants?.data?.find(p => p.id !== PAGE_ID);
          return participant
            ? {
                id: participant.id,
                name: participant.name || "Player",
                lastActive: new Date(c.updated_time).getTime(),
                lastSent: 0
              }
            : null;
        }).filter(Boolean);

        fs.writeFileSync(USERS_FILE, JSON.stringify(freshUsers, null, 2));
        console.log(`✅ Auto-synced ${freshUsers.length} users successfully`);
        users = freshUsers;
      } else {
        console.log("❌ Auto-sync failed — no data returned.");
      }
    } catch (err) {
      console.error("❌ Auto-sync error:", err);
    }
  }

  return users;
}

// ===== MAIN AUTO ONLINE PROMO =====
async function autoOnlinePromo() {
  const startTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });
  console.log(`📡 AutoOnlinePromo started at ${startTime}`);

  // ✅ Check if promo paused
  if (isPaused()) {
    console.log("⏸️ Promo is currently paused. Aborting execution.");
    return;
  }

  let users = await autoSyncIfEmpty();
  if (!users.length) {
    console.log("❌ No users available even after sync — exiting.");
    return;
  }

  const now = Date.now();
  const recentlyActive = users.filter(u => now - u.lastActive <= 60 * 60 * 1000); // Active within 1 hour
  if (!recentlyActive.length) {
    console.log("⚠️ No recently active users found");
    return;
  }

  const selectedUsers = recentlyActive.slice(0, 182);
  console.log(`🎯 Found ${recentlyActive.length} eligible users | Sending to: ${selectedUsers.length}`);

  let sent = 0, failed = 0, skipped = 0;

  for (const u of selectedUsers) {
    // Mid-run pause check
    if (isPaused()) {
      console.log("⏸️ Detected pause mid-run — stopping immediately.");
      break;
    }

    // Cooldown skip
    if (u.lastSent && (now - u.lastSent < 30 * 60 * 1000)) {
      console.log(`⏸️ Skipping ${u.name} — last promo sent recently`);
      skipped++;
      continue;
    }

    const msg = await generateMessage(u.name?.split(" ")[0] || "Player");
    console.log(`📩 Sending to ${u.name || u.id}...`);
    const success = await sendMessage(u.id, msg);
    if (success) {
      u.lastSent = Date.now();
      sent++;
    } else {
      failed++;
    }

    // Slow down to prevent FB rate limits
    await new Promise(r => setTimeout(r, 400));
  }

  writeUsers(users);

  // ===== Save promo stats =====
  const stats = {
    timestamp: new Date(),
    startedAt: startTime,
    sent,
    failed,
    skipped,
    totalActive: recentlyActive.length,
    totalUsers: users.length,
    pausedDuringRun: isPaused()
  };
  fs.writeFileSync("promo_stats.json", JSON.stringify(stats, null, 2));

  console.log(`✅ AutoOnlinePromo finished — Sent: ${sent} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log("💾 Saved promo_stats.json successfully");
}

// ===== Run when file executed directly =====
autoOnlinePromo();
