import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// --- CONFIG ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
const SECRET = process.env.SEND_SECRET || "khizarBulkKey123";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ACTIVE_WINDOW_HOURS = 24;
const INSTANT_COOLDOWN_HOURS = 2;
const FALLBACK_COOLDOWN_HOURS = 6;
const USERS_FILE = "users.json";

// --- read/write helpers ---
function readUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch (e) { console.error("Error reading users.json", e); }
  return [];
}
function writeUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch (e) { console.error("Error writing users.json", e); }
}

// --- AI Promo Generator ---
async function generateAIPromo(firstName) {
  if (!OPENAI_API_KEY) return `Hi ${firstName} 👋 Claim your bonus now!`;
  const prompt = `You are an expert short-campaign copywriter for online games and casinos.
Create one catchy promo (max 25 words), include bonus %, urgency, and user name.`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write short friendly casino promos." },
          { role: "user", content: `${prompt}\\nName: ${firstName}` }
        ],
        max_tokens: 60,
        temperature: 0.9
      })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text?.trim() || `Hi ${firstName} 👋 Claim your bonus now!`;
  } catch {
    return `Hi ${firstName} 👋 Claim your bonus now!`;
  }
}

// --- FB send ---
async function sendMessage(id, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id }, message: { text } })
  });
}

// --- Pagination conversation fetch ---
async function fetchAllConversations() {
  const base = `https://graph.facebook.com/v18.0/${PAGE_ID}/conversations?fi_
