import express from "express";
import TokenService from "../token/tockenService.js";
import OffresController from "../controllers/offres.controller.js";
import { upload } from "../common.js";

const router = express.Router();
const tockenService = new TokenService()

// GET - Récupérer toutes les offres du recruteur avec statistiques détaillées
router.get("/recruteur/offres-analyse", tockenService.verifyToken, OffresController.getAllRecruitersOffers);

// GET - Top offres les plus demandées (pour un recruteur)
router.get("/recruteur/top-offres", tockenService.verifyToken, OffresController.mostRequestedOffers);

// GET - Offres les moins demandées (pour un recruteur)
router.get("/recruteur/bottom-offres", tockenService.verifyToken, OffresController.leastRequestedOffers);

// Vérifier si un candidat a déjà postulé à une offre
router.get("/check-application/:offreId", tockenService.verifyToken, OffresController.hasCandidateAppliedToJob);

// Postuler à une offre
router.post("/postuler/:offreId", tockenService.verifyToken, OffresController.applyForJob)

// Upload CV depuis le profil
router.post("/upload-cv", tockenService.verifyToken, upload.single("cv"), OffresController.uploadCvFromProfile);

// Ajouter une offre
router.post("/addoffre",  tockenService.verifyToken, OffresController.addOffer);

// Voir mes offres
router.get("/mesoffres",  tockenService.verifyToken, OffresController.showOffer);

// Supprimer une offre
router.delete("/deleteoffre/:id",  tockenService.verifyToken, OffresController.deleteOffer);

// Modifier une offre
router.put("/updateoffre/:id",  tockenService.verifyToken, OffresController.updateOffer);

// Voir toutes les offres
router.get("/offres", tockenService.verifyToken, OffresController.showAllOffer);

// GET - Analyse détaillée d'une offre spécifique
router.get("/recruteur/offre-analyse/:offreId", tockenService.verifyToken, OffresController.analyzeJobOffer);

export default router;