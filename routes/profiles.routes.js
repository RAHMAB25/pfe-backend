import express from "express";
import TokenService from "../token/tockenService.js";
import ProfilesController from "../controllers/profiles.controller.js";
import { upload } from "../common.js";

const router = express.Router();
const tockenService = new TokenService()

// =============================================
// ROUTES POUR LES PROFILES
// =============================================

// GET stats profil
router.get("/profile/stats", tockenService.verifyToken, ProfilesController.getStatProfile);

// Dans la route /verification (login)
router.post("/verification", ProfilesController.login);

// GET profil
router.get("/profile", tockenService.verifyToken, ProfilesController.getProfile);

// UPDATE profil
router.put("/profile", tockenService.verifyToken, ProfilesController.updateProfile);

// Upload CV lors de l'inscription
router.post('/adduser', upload.single('cv'), ProfilesController.uploadCV);


// Route pour lister les CVs dans le dossier uploads
router.get("/list-cvs", tockenService.verifyToken, ProfilesController.cvList);

// DELETE CV
router.delete("/delete-cv", tockenService.verifyToken, ProfilesController.deleteCv);

// GET fichier uploadé
router.get("/uploads/:filename", ProfilesController.getUploadedFile);

export default router;