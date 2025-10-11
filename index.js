import express from "express";
import fetch from "node-fetch"; // ✅ use node-fetch v3

const app = express();
app.use(express.json());

// ✅ Facebook verification endpoint
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "bomappbykhizar123"; // same token you used in Meta dashboard
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

// ✅ Handle incoming messages
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const event = entry.messaging[0];
      console.log("📩 New event:", event);

      // Example: Auto-reply if message received
      if (event.message && event.sender && event.sender.id) {
        const senderId = event.sender.id;
        const messageText = event.message.text || "Hello 👋";

        await sendMessage(senderId, `You said: ${messageText}`);
      }
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ✅ Send a message to user
async function sendMessage(recipientId, messageText) {
  const PAGE_ACCESS_TOKEN = "YOUR_PAGE_ACCESS_TOKEN_HERE"; // paste your real token here

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
    console.log("📤 Message sent:", data);
  } catch (error) {
    console.error("❌ Error sending message:", error);
  }
}

// ✅ Render requires dynamic port binding
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 BomAppByKhizar Webhook running on port ${PORT}`)
);
