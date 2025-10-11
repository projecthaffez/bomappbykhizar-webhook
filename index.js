import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "bomappbykhizar123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// ✅ 1. Verify Webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// ✅ 2. Handle Messages
app.post("/webhook", async (req, res) => {
  if (req.body.object === "page") {
    for (const entry of req.body.entry) {
      const event = entry.messaging[0];
      if (event.sender?.id && event.message) {
        const senderId = event.sender.id;
        saveUser(senderId); // store user
        const text = event.message.text || "👋";
        await sendMessage(senderId, `You said: "${text}" 😊`);
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }
  res.sendStatus(404);
});

// ✅ 3. Save unique user IDs
function saveUser(id) {
  try {
    const data = JSON.parse(fs.readFileSync("users.json", "utf8"));
    if (!data.users.includes(id)) {
      data.users.push(id);
      fs.writeFileSync("users.json", JSON.stringify(data, null, 2));
      console.log(`📁 Saved new user: ${id}`);
    }
  } catch (e) {
    console.error("Error saving user:", e);
  }
}

// ✅ 4. Send single message
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

// ✅ 5. Bulk sender endpoint (secured)
app.post("/send-bulk", async (req, res) => {
  const { message, secret } = req.body;
  if (secret !== process.env.SEND_SECRET) return res.status(403).send("Unauthorized");

  const data = JSON.parse(fs.readFileSync("users.json", "utf8"));
  for (const id of data.users) {
    await sendMessage(id, message);
    await new Promise((r) => setTimeout(r, 500)); // delay 0.5s between messages
  }
  res.send(`✅ Sent to ${data.users.length} users`);
});

// ✅ Render dynamic port
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar Bulk Sender running on port ${PORT}`));
