import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { Configuration, OpenAIApi } from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

// OpenAI client (pour transcription + conseils)
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

// WebSocket serveur pour pousser le feedback en live
const wss = new WebSocketServer({ noServer: true });
let clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

// HTTP serveur + upgrade WebSocket
const server = app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Endpoint pour recevoir des chunks audio (PCM/opus en base64 par ex.)
app.post("/api/audio-chunk", async (req, res) => {
  try {
    const { sessionId, role, audioBase64 } = req.body; // role = "seller" | "client"

    // 1) Décoder l'audio et envoyer à l'API de transcription (simplifié, pseudo-code)
    // const audioBuffer = Buffer.from(audioBase64, "base64");
    // const transcript = await callWhisper(audioBuffer);

    const transcript = "[transcription simulée pour le POC]";

    // 2) Générer le conseil IA à partir du transcript + rôle + contexte
    const prompt = `
Tu es un coach de vente. 
Tu écoutes en temps réel une discussion entre un client et un commercial.
Rôle qui vient de parler: ${role}.
Dernier extrait: "${transcript}".

Donne un conseil ACTIONNABLE et concis au commercial (en français), 
basé sur les principes méthodo vus en formation. 
Réponds en 1 à 2 phrases maximum.`;

    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const advice = completion.data.choices[0].message.content;

    // 3) Broadcast du conseil aux clients WebSocket connectés sur cette session
    const payload = JSON.stringify({
      type: "advice",
      sessionId,
      role,
      transcript,
      advice,
      timestamp: new Date().toISOString(),
    });

    clients.forEach((ws) => {
      ws.send(payload);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "processing_error" });
  }
});
