import express from "express";

import CandidatNotificationsController from "../controllers/notifictaions.controller.js";
import TokenService from "../token/tockenService.js";

const router = express.Router();
const tockenService = new TokenService() 

// =============================================
// ROUTES POUR LES NOTIFICATIONS
// =============================================

// GET - Récupérer les notifications d'un candidat
router.get("/notifications", tockenService.verifyToken, CandidatNotificationsController.getCandidatNotifications);

// GET - Compter les notifications non lues
router.get("/notifications/non-lues/count", tockenService.verifyToken, CandidatNotificationsController.conmpareNotReadedNotifications);

// PUT - Marquer une notification comme lue
router.put("/notifications/:notificationId/lire", tockenService.verifyToken, CandidatNotificationsController.markANotificationAsRead);

// PUT - Marquer toutes les notifications comme lues
router.put("/notifications/tout-lire", tockenService.verifyToken, CandidatNotificationsController.markAllNotificationAsRead);

export default router;