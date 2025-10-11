import express from "express";
const app = express();
app.use(express.json());

// ✅ Facebook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "bomappbykhizar123"; // choose your verify token
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
app.post("/webhook", (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    body.entry.forEach((entry) => {
      const event = entry.messaging[0];
      console.log("📩 New incoming event:", event);
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

app.listen(3000, () => console.log("🚀 BomAppByKhizar Webhook running on port 3000"));
