import dotenv from 'dotenv';
import express from "express";
import Groq from 'groq-sdk';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import offreRoutes from "./routes/offres.routes.js"
import chatRoutes from "./routes/chat.routes.js"
import dashboardRoutes from "./routes/dashboard.routes.js"
import notificationRoutes from "./routes/notifications.routes.js"
import profilesRoutes from "./routes/profiles.routes.js"
import candidatureRoutes from "./routes/candidatures.routes.js"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const PORT = 3000;
const app = express();
const server = http.createServer(app);

// Configuration Socket.IO avec CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3001", 
    credentials: true
  }
});

// Middleware CORS
app.use(cors({
  origin: "http://localhost:3001", // Modifiez selon votre frontend
  credentials: true
}));

// Stocker les utilisateurs connectés
const users = {};
// =============================================
// SOCKET.IO GESTION
// =============================================
io.on("connection", (socket) => {
  console.log("🔌 Nouvelle connexion socket:", socket.id);
  // Associer userId à la room
  socket.on("join", (userId) => {
    users[userId] = socket.id;
    socket.join(`user_${userId}`);
    console.log(`✅ Utilisateur ${userId} connecté - Room: user_${userId}`);
  });

  socket.on("disconnect", () => {
    // Supprimer l'utilisateur déconnecté
    for (let userId in users) {
      if (users[userId] === socket.id) {
        delete users[userId];
        console.log(`❌ Utilisateur ${userId} déconnecté`);
        break;
      }
    }
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Config routes
app.use("/",candidatureRoutes, chatRoutes, dashboardRoutes, notificationRoutes,offreRoutes, profilesRoutes )

// =============================================
// DÉMARRAGE DU SERVEUR
// =============================================
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  console.log(`📡 Socket.IO prêt à recevoir des connexions`);
});