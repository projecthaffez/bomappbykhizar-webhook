import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// 🧠 Config
const VERIFY_TOKEN = "bomappbykhizar123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SEND_SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const SYNC_SECRET = process.env.SYNC_SECRET || SEND_SECRET;
const USERS_FILE = "users.json";

// 🧩 Helper functions
function readUsersFile() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { users: [] };
  }
}

function writeUsersFile(obj) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2));
}

// ✅ 1. Verify webhook (Meta setup)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// ✅ 2. Handle messages (auto-reply + save users)
app.post("/webhook", async (req, res) => {
  if (req.body.object === "page") {
    for (const entry of req.body.entry) {
      const event = entry.messaging[0];
      if (event.sender?.id && event.message) {
        const senderId = event.sender.id;
        saveUser(senderId);
        const text = event.message.text || "👋 Hello!";
        await sendMessage(senderId, `You said: "${text}" 😊`);
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }
  res.sendStatus(404);
});

function saveUser(id) {
  try {
    const data = readUsersFile();
    if (!data.users.includes(id)) {
      data.users.push(id);
      writeUsersFile(data);
      console.log(`📁 Saved new user: ${id}`);
    }
  } catch (e) {
    console.error("❌ Error saving user:", e);
  }
}

// ✅ 3. Send single message
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const body = { recipient: { id: recipientId }, message: { text } };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) console.error("Meta API Error:", data.error);
    else console.log(`📤 Sent to ${recipientId}`);
  } catch (e) {
    console.error("Send error:", e);
  }
}

// ✅ 4. Bulk sender (manual trigger)
app.post("/send-bulk", async (req, res) => {
  const { message, secret } = req.body;
  if (secret !== SEND_SECRET) return res.status(403).send("Unauthorized");

  const data = readUsersFile();
  let sent = 0;

  for (const id of data.users) {
    await sendMessage(id, message);
    sent++;
    await new Promise((r) => setTimeout(r, 500));
  }

  res.send(`✅ Sent to ${sent} users`);
});

// ✅ 5. Conversation scanner (sync old users)
async function fetchAllParticipantIds() {
  if (!PAGE_ACCESS_TOKEN || !PAGE_ID) throw new Error("Missing PAGE_ACCESS_TOKEN or PAGE_ID");

  const base = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations`;
  let url = `${base}?fields=participants.limit(100){id}&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;
  const found = new Set();

  while (url) {
    console.log("📡 Fetching:", url);
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      console.error("❌ Facebook API Error:", json.error);
      throw json.error;
    }

    if (Array.isArray(json.data)) {
      for (const convo of json.data) {
        if (convo.participants && Array.isArray(convo.participants.data)) {
          for (const p of convo.participants.data) {
            if (p.id && p.id !== PAGE_ID) found.add(p.id);
          }
        }
      }
    }

    url = json.paging?.next || null;
    if (url) await new Promise((r) => setTimeout(r, 300));
  }

  return Array.from(found);
}

// ✅ 6. Endpoint to sync users
app.post("/sync-users", async (req, res) => {
  try {
    if (req.body?.secret !== SYNC_SECRET) return res.status(403).send("Unauthorized");

    console.log("🔄 Sync started...");
    const remoteIds = await fetchAllParticipantIds();
    console.log(`📦 Found ${remoteIds.length} users from Page conversations.`);

    const local = readUsersFile();
    const localSet = new Set(local.users);
    let added = 0;

    for (const id of remoteIds) {
      if (!localSet.has(id)) {
        local.users.push(id);
        localSet.add(id);
        added++;
      }
    }

    writeUsersFile(local);
    console.log(`✅ Sync complete. Added ${added} new users. Total: ${local.users.length}.`);
    res.send({ added, total: local.users.length });
  } catch (err) {
    console.error("❌ Sync error:", err);
    res.status(500).send({ error: err.message || err });
  }
});

// ✅ 7. Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar running on port ${PORT}`));