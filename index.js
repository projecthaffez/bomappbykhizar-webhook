import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "bomappbykhizar123";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// ✅ Facebook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully ✅");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Handle incoming messages
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const event = entry.messaging[0];
      console.log("📩 New incoming event:", event);

      // ✅ If message received, send a reply
      if (event.message && event.sender && event.sender.id) {
        const senderId = event.sender.id;
        const userMessage = event.message.text;

        const replyText = `Hi! You said: "${userMessage}" 👋`;

        await sendMessage(senderId, replyText);
      }
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ✅ Function to send message via Graph API
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const messageData = {
    recipient: { id: recipientId },
    message: { text },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messageData),
    });
    const data = await response.json();
    console.log("✅ Message sent:", data);
  } catch (error) {
    console.error("❌ Error sending message:", error);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar Webhook running on port ${PORT}`));
