import express from "express";
import TokenService from "../token/tockenService.js";
import DashboardController from "../controllers/dashboard.controller.js";

const router = express.Router();
const tockenService = new TokenService() 


// =============================================
// ROUTES POUR LE TABLEAU DE BORD
// =============================================

// GET - Statistiques complètes pour le dashboard candidat
router.get("/dashboard/stats", tockenService.verifyToken, DashboardController.getstats);

// ROUTE - Top offres avec nombre de candidats (pour le dashboard candidat)
router.get("/dashboard/top-offres-candidats", tockenService.verifyToken, DashboardController.getTopOfferForCandidat);

// GET - Statistiques globales pour le dashboard recruteur
router.get("/recruteur/stats-globales", tockenService.verifyToken, DashboardController.overallStatistics);

export default router;


