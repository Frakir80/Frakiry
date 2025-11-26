const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { WebSocketServer } = require("ws");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 4000;

// OpenAI client (pour future usage IA, non utilisé ici pour le test)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// Endpoint POST minimal pour debug : /api/audio-chunk
app.post("/api/audio-chunk", async (req, res) => {
  try {
    const { sessionId, role, audioBase64 } = req.body;
    console.log("audioBase64 reçu. Taille :", audioBase64 ? audioBase64.length : 0);

    // Transcription simulée pour le test (remplace plus tard par la vraie transcription)
    const transcript = "[transcription simulée pour le POC]";

    // Construction du prompt IA
    const prompt = `
Tu es un coach de vente. 
Tu écoutes en temps réel une discussion entre un client et un commercial.
Rôle qui vient de parler: ${role}.
Dernier extrait: "${transcript}".

Donne un conseil ACTIONNABLE et concis au commercial (en français), 
basé sur les principes méthodo vus en formation. 
Réponds en 1 à 2 phrases maximum.
    `;

    // Appel à OpenAI (modèle de ton choix)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // ou "gpt-3.5-turbo" si tu n'as pas accès à gpt-4o
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4
    });

    res.json({
      transcript,
      advice: completion.choices?.[0]?.message?.content || "Pas de conseil généré"
    });
  } catch(e) {
    console.error("Erreur endpoint audio-chunk :", e);
    res.status(500).json({ error: "processing_error" });
  }
});


// (ne mets rien d'autre à la fin du fichier !)
