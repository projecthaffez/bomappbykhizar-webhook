import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";

let users = [];
if (fs.existsSync("users.json"))
  users = JSON.parse(fs.readFileSync("users.json"));
const saveUsers = () =>
  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));

function generatePromo() {
  const promos = [
    "You're online now! 🎯 Claim your 200% bonus instantly!",
    "Don’t miss today’s 180% bonus — available only for active players!",
    "Deposit now and double your winnings before the timer runs out!",
    "Ready to win big? 💰 Get 190% extra on your next play!",
    "Your lucky hour just started! 🎉 Grab your 175% reward now!"
  ];
  return promos[Math.floor(Math.random() * promos.length)];
}

async function getFirstName(userId) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${userId}?fields=first_name&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await res.json();
    return data.first_name || "Player";
  } catch {
    return "Player";
  }
}

async function sendMessage(id, msg) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id }, message: { text: msg } })
  });
}

async function getActiveUsers() {
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fields=participants.limit(100){id},updated_time&limit=100&access_token=${PAGE_ACCESS_TOKEN}`
  );
  const data = await res.json();
  const now = new Date();
  const active = [];

  if (data.data) {
    for (const c of data.data) {
      const updated = new Date(c.updated_time);
      const mins = (now - updated) / (1000 * 60);
      if (mins <= 10) {
        const uid = c.participants?.data?.find((u) => u.id !== PAGE_ID)?.id;
        if (uid) active.push(uid);
      }
    }
  }
  return active;
}

app.post("/auto-promo", async (req, res) => {
  if (req.body.secret !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  console.log("\n📡 Checking for active users...");
  const now = Date.now();

  try {
    const activeUsers = await getActiveUsers();
    let sent = 0;

    if (activeUsers.length > 0) {
      console.log(`🟢 Found ${activeUsers.length} active users`);
      for (const id of activeUsers) {
        let user = users.find((u) => u.id === id);
        if (!user) { user = { id, lastSent: 0 }; users.push(user); }
        const diff = (now - (user.lastSent || 0)) / (1000 * 60 * 60);
        if (diff >= 2) {
          const firstName = await getFirstName(id);
          const promo = generatePromo();
          await sendMessage(id, `Hi ${firstName} 👋 ${promo}`);
          user.lastSent = now;
          sent++;
          console.log(`📤 Sent instant promo to ${firstName} (${id})`);
        }
      }
    }

    const hr = new Date().getHours();
    const fallbackHours = [8, 16, 0];
    const isFallbackTime = fallbackHours.includes(hr);
    if (isFallbackTime && activeUsers.length === 0) {
      console.log("😴 No active users — sending scheduled promo to all inactive players...");
      for (const u of users) {
        const diff = (now - (u.lastSent || 0)) / (1000 * 60 * 60);
        if (diff >= 6) {
          const firstName = await getFirstName(u.id);
          const promo = generatePromo();
          await sendMessage(u.id, `Hi ${firstName} 👋 ${promo}`);
          u.lastSent = now;
          sent++;
          console.log(`📤 Sent fallback promo to ${firstName} (${u.id})`);
        }
      }
    }

    saveUsers();
    console.log(`✅ Total promos sent: ${sent}`);
    res.json({ sent, active: activeUsers.length });
  } catch (err) {
    console.error("❌ Error in /auto-promo", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(10000, () => console.log("🚀 BomAppByKhizar AI Auto Promo v3.0 running on port 10000"));
