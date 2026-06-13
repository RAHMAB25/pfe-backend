import express from "express";
import TokenService from "../token/tockenService.js";
import ChatController from "../controllers/chat.controller.js";

const router = express.Router();
const tockenService = new TokenService()

// =============================================
// ROUTE CHAT - GPT-4 avec analyse CV + matching offres
// =============================================

router.post('/chat', tockenService.verifyToken, ChatController.chat);

// Effacer l'historique de conversation
router.delete('/chat/reset', tockenService.verifyToken, ChatController.deleteHisto);

export default router;

