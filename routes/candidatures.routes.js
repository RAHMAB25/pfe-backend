import express from "express";
import CandidatureController from "../controllers/candidature.controller.js";
import TokenService from "../token/tockenService.js";

const router = express.Router();
const tockenService = new TokenService() 

// PUT - Mettre à jour le statut d'une candidature
router.put("/recruteur/candidatures/:candidatureId/statut",tockenService.verifyToken,CandidatureController.updateCandidature)

// ROUTE - SUPPRIMER UN COMPTE CANDIDAT
router.delete("/delete-account", tockenService.verifyToken, CandidatureController.deleteCandidat);

// GET mes candidatures
router.get("/mescandidatures", tockenService.verifyToken, CandidatureController.retrieveMyCandidautes);

// GET - Récupérer les candidatures avec détails des candidats et extraction du texte du CV
router.post("/recruteur/analyze-cv/:id", tockenService.verifyToken, CandidatureController.getAllCandidatures);

// GET - Récupérer toutes les candidatures pour les offres d'un recruteur
router.get("/recruteur/candidatures", tockenService.verifyToken, CandidatureController.getAllRecruiterOffresCandidatures);

// Route de test pour extraire un CV spécifique (à ajouter avant le démarrage du serveur)
router.get("/test-extract-cv/:candidatureId", tockenService.verifyToken, CandidatureController.testCvExtarct);

// GET - Évolution des candidatures par mois pour un recruteur
router.get("/recruteur/evolution-candidatures", tockenService.verifyToken, CandidatureController.evaluateCandidature );

export default router;