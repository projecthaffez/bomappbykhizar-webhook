import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ✅ Your verify token (must match the one in Meta Developer dashboard)
const VERIFY_TOKEN = "bomappbykhizar123";

// ✅ Webhook verification endpoint
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Handle incoming webhook events
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const event = entry.messaging[0];
      console.log("📩 New event:", event);

      // If a message is received, send a reply
      if (event.message && event.sender && event.sender.id) {
        const senderId = event.sender.id;
        const userMessage = event.message.text || "👋 Hello!";
        const replyText = `You said: "${userMessage}" 😊`;

        await sendMessage(senderId, replyText);
      }
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ✅ Function to send a message back to user
async function sendMessage(recipientId, messageText) {
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // ✅ token stored in Render Environment
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

  const payload = {
    recipient: { id: recipientId },
    message: { text: messageText },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.error) {
      console.error("❌ Error from Meta API:", data.error);
    } else {
      console.log("📤 Message sent successfully:", data);
    }
  } catch (error) {
    console.error("❌ Error sending message:", error);
  }
}

// ✅ Dynamic port for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 BomAppByKhizar Webhook running on port ${PORT}`));
