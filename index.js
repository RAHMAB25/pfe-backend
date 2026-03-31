const express = require("express");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const pool = require("./db");
const fs = require('fs').promises; 




const app = express();
const PORT = 3000;

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

// Configuration Socket.IO avec CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3001", 
    credentials: true
  }
});

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

// =============================================
// FONCTION UTILITAIRE POUR LES NOTIFICATIONS
// =============================================
async function sendNotification(candidatId, candidatureId, message, type) {
  try {
    // 1. Sauvegarder en base de données
    const result = await pool.query(
      `INSERT INTO notifications (candidat_id, candidature_id, message, type, est_lu, date_creation)
       VALUES ($1, $2, $3, $4, false, NOW())
       RETURNING id, date_creation`,
      [candidatId, candidatureId, message, type]
    );
    
    // 2. Envoyer en temps réel si l'utilisateur est connecté
    const socketId = users[candidatId];
    if (socketId) {
      io.to(socketId).emit("receiveNotification", {
        id: result.rows[0].id,
        message: message,
        type: type,
        candidatureId: candidatureId,
        date: result.rows[0].date_creation,
        est_lu: false
      });
      console.log(`📨 Notification temps réel envoyée au candidat ${candidatId}`);
    } else {
      console.log(`💾 Notification sauvegardée (candidat ${candidatId} non connecté)`);
    }
    
    return result.rows[0].id;
  } catch (error) {
    console.error("❌ Erreur envoi notification:", error);
    return null;
  }
}

// Middleware CORS
app.use(cors({
  origin: "http://localhost:3001", // Modifiez selon votre frontend
  credentials: true
}));

// 🔐 Middleware pour vérifier JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Access denied" });
  }
   
  const token = authHeader.split(" ")[1];
  try {
    const verified = jwt.verify(token, "secretkey");
    req.user = verified;
    next();
  } catch (err) {
    return res.status(400).json({ error: "Invalid token" });
  }
};

// Configuration multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `cv-${uniqueSuffix}.pdf`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// =============================================
// ROUTES D'UPLOAD (AVANT express.json)
// =============================================

// Upload CV lors de l'inscription
app.post('/adduser', upload.single('cv'), async (req, res) => {
  try {
    const created_at = new Date();
    const { nom, surname, email, tel, domaine, localisation, mot_de_passe, role } = req.body;
    
    if (!nom || !surname || !email || !mot_de_passe || !role) {
      return res.status(400).json({ error: "Tous les champs requis" });
    }

    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Cet email est déjà utilisé" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(mot_de_passe, saltRounds);

    let cvFilename = null;
    if (req.file) {
      cvFilename = req.file.filename;  
    }

    const result = await pool.query(
      `INSERT INTO users
        (nom, prénom, email, téléphone, domaine, localisation, mot_de_passe, role, cv, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nom, prénom, email, role`,
      [nom, surname, email, tel || null, domaine || null, localisation || null, 
       hashedPassword, role, cvFilename, created_at]
    );

    res.status(201).json({ 
      success: true, 
      message: "Compte créé avec succès",
      user: result.rows[0] 
    });

  } catch (err) {
    console.error("Erreur serveur:", err.message);
    res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
});

// Vérifier si un candidat a déjà postulé à une offre
app.get("/check-application/:offreId", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès réservé aux candidats" });
    }

    const { offreId } = req.params;
    const candidatId = req.user.id;

    const offreCheck = await pool.query(
      "SELECT id FROM offres WHERE id = $1",
      [offreId]
    );

    if (offreCheck.rows.length === 0) {
      return res.status(404).json({ error: "Offre non trouvée" });
    }

    const check = await pool.query(
      "SELECT id FROM candidatures WHERE candidat_id = $1 AND offre_id = $2",
      [candidatId, offreId]
    );

    const hasApplied = check.rows.length > 0;

    res.json({ 
      hasApplied,
      offreId,
      candidatId
    });

  } catch (err) {
    console.error("Erreur vérification candidature:", err);
    res.status(500).json({ 
      error: "Erreur serveur lors de la vérification",
      details: err.message 
    });
  }
});

// Postuler à une offre
app.post("/postuler/:offreId", verifyToken, (req, res) => {
  upload.single("cv")(req, res, async (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: "Le fichier ne doit pas dépasser 5 Mo" });
          }
          return res.status(400).json({ error: "Erreur d'upload: " + err.message });
        }
        return res.status(400).json({ error: err.message });
      }

      if (!req.user) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      if (req.user.role !== "CANDIDAT") {
        return res.status(403).json({ error: "Seul un candidat peut postuler" });
      }

      const { offreId } = req.params;
      const candidatId = req.user.id;

      if (!offreId) {
        return res.status(400).json({ error: "ID de l'offre manquant" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "CV obligatoire (format PDF)" });
      }

      const cvFilename = req.file.filename;

      const offreCheck = await pool.query(
        "SELECT id, titre FROM offres WHERE id = $1",
        [offreId]
      );

      if (offreCheck.rows.length === 0) {
        return res.status(404).json({ error: "Offre non trouvée" });
      }

      const check = await pool.query(
        "SELECT id FROM candidatures WHERE candidat_id = $1 AND offre_id = $2",
        [candidatId, offreId]
      );

      if (check.rows.length > 0) {
        return res.status(400).json({
          error: "Vous avez déjà postulé à cette offre"
        });
      }

      const result = await pool.query(
        `INSERT INTO candidatures (candidat_id, offre_id, cv, statut, date_postulation)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, candidat_id, offre_id, cv, statut, date_postulation`,
        [candidatId, offreId, cvFilename, "EN_ATTENTE"]
      );

      res.status(201).json({
        success: true,
        message: "Candidature envoyée avec succès",
        candidature: result.rows[0]
      });

    } catch (err) {
      console.error("ERROR DÉTAILLÉ:", err);
      if (err.code === '42703') {
        return res.status(500).json({ 
          error: "Erreur de configuration de la base de données",
          details: "La colonne 'cv' n'existe pas dans la table candidatures"
        });
      }
      res.status(500).json({ 
        error: "Erreur serveur lors de la candidature", 
        details: err.message 
      });
    }
  });
});

// Upload CV depuis le profil
app.post("/upload-cv", verifyToken, upload.single("cv"), async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Fichier CV requis" });
    }

    const cvFilename = req.file.filename;
    const userId = req.user.id;

    await pool.query(
      "UPDATE users SET cv = $1 WHERE id = $2",
      [cvFilename, userId]
    );

    res.json({ 
      success: true, 
      filename: cvFilename,
      message: "CV uploadé avec succès" 
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =============================================
// MIDDLEWARES JSON (APRÈS les routes d'upload)
// =============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================
// ROUTES JSON (sans upload)
// =============================================

// Login
app.post("/verification", async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
    }

    const user = result.rows[0];
    console.log("🚀 ~ user:", user)
    const match = await bcrypt.compare(mot_de_passe, user.mot_de_passe);

    if (!match) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      "secretkey",
      { expiresIn: "1d" }
    );

    res.json({ 
      success: true, 
      token: token,
      user: {
        id: user.id,
        role: user.role,
        nom: user.nom,
        prénom: user.prénom
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Ajouter une offre
app.post("/addoffre", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const { titre, description } = req.body;
    if (!titre || !description) {
      return res.status(400).json({ error: "Tous les champs sont requis" });
    }

    const newOffre = await pool.query(
      "INSERT INTO offres (titre, description, recruteur_id) VALUES ($1, $2, $3) RETURNING *",
      [titre, description, req.user.id]
    );

    res.json(newOffre.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Voir mes offres
app.get("/mesoffres", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const result = await pool.query(
      "SELECT * FROM offres WHERE recruteur_id = $1 ORDER BY date_creation DESC",
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Supprimer une offre
app.delete("/deleteoffre/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const { id } = req.params;

    const check = await pool.query(
      "SELECT * FROM offres WHERE id = $1 AND recruteur_id = $2",
      [id, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Offre non trouvée ou non autorisée" });
    }

    await pool.query("DELETE FROM offres WHERE id = $1", [id]);

    res.json({ message: "Offre supprimée avec succès" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Modifier une offre
app.put("/updateoffre/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const { id } = req.params;
    const { titre, description } = req.body;

    if (!titre || !description) {
      return res.status(400).json({ error: "Titre et description requis" });
    }

    const check = await pool.query(
      "SELECT * FROM offres WHERE id = $1 AND recruteur_id = $2",
      [id, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Offre non trouvée ou non autorisée" });
    }

    const updated = await pool.query(
      "UPDATE offres SET titre = $1, description = $2 WHERE id = $3 RETURNING *",
      [titre, description, id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Voir toutes les offres
app.get("/offres", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT offres.id, offres.titre, offres.description, offres.date_creation as date_publication,
              users.nom AS recruteur_nom
       FROM offres 
       JOIN users ON offres.recruteur_id = users.id 
       ORDER BY offres.date_creation DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET profil
app.get("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT nom, prénom, email, téléphone, domaine, localisation, cv FROM users WHERE id = $1',
      [userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// UPDATE profil
app.put("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { nom, prénom, email, téléphone, domaine, localisation } = req.body;

    await pool.query(
      `UPDATE users 
       SET nom=$1, prénom=$2, email=$3, téléphone=$4, domaine=$5, localisation=$6
       WHERE id=$7`,
      [nom, prénom, email, téléphone, domaine, localisation, userId]
    );

    res.json({ message: "Profil mis à jour" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET mes candidatures
app.get("/mescandidatures", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const result = await pool.query(
      `SELECT c.id AS candidature_id, o.titre AS offre_titre, u.nom AS recruteur_nom,
              c.statut, c.date_postulation
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON o.recruteur_id = u.id
       WHERE c.candidat_id = $1
       ORDER BY c.date_postulation DESC`,
      [req.user.id]
    );

    // Convertir les statuts pour l'affichage
    const statutMapping = {
      'EN_ATTENTE': 'EN ATTENTE',
      'EN_COURS': 'EN COURS',
      'ACCEPTE': 'ACCEPTÉE',
      'REFUSE': 'REFUSÉE'
    };

    const candidaturesFormatees = result.rows.map(c => ({
      ...c,
      statut: statutMapping[c.statut] || c.statut
    }));

    res.json(candidaturesFormatees);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Récupérer les candidatures avec détails des candidats et extraction du texte du CV
app.get("/recruteur/candidatures-analyse", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    const result = await pool.query(
      `SELECT 
        c.id AS candidature_id,
        c.statut,
        c.date_postulation,
        c.cv AS candidature_cv,
        o.id AS offre_id,
        o.titre AS offre_titre,
        u.id AS candidat_id,
        u.nom AS candidat_nom,
        u.prénom AS candidat_prenom,
        u.email AS candidat_email,
        u.téléphone AS candidat_telephone,
        u.domaine AS candidat_domaine,
        u.localisation AS candidat_localisation,
        u.cv AS candidat_cv
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON c.candidat_id = u.id
       WHERE o.recruteur_id = $1
       ORDER BY c.date_postulation DESC`,
      [recruteurId]
    );

    console.log(`📊 ${result.rows.length} candidatures trouvées`);

    // Pour chaque candidature, extraire le texte du CV
    const candidatsAvecCV = await Promise.all(result.rows.map(async (row) => {
      let cv_text = null;
      const cvFilename = row.candidat_cv;
      
      if (cvFilename) {
        try {
          const cvPath = path.join(__dirname, 'uploads', cvFilename);
          console.log(`📄 Traitement du CV: ${cvFilename}`);
          
          const fsSync = require('fs');
          if (fsSync.existsSync(cvPath)) {
            // Utiliser l'extracteur avec OCR
            cv_text = await pdfExtractor.extractText(cvPath);
            
            if (cv_text && cv_text.trim().length > 0) {
              console.log(`✅ Texte extrait (${cv_text.length} caractères) pour ${row.candidat_prenom} ${row.candidat_nom}`);
              console.log(`   Extrait: ${cv_text.substring(0, 150)}...`);
            } else {
              console.log(`⚠️ Aucun texte extractible pour ${row.candidat_prenom} ${row.candidat_nom}`);
              cv_text = null;
            }
          } else {
            console.log(`❌ Fichier non trouvé: ${cvPath}`);
          }
        } catch (err) {
          console.error(`❌ Erreur extraction pour ${row.candidat_prenom} ${row.candidat_nom}:`, err.message);
          cv_text = null;
        }
      } else {
        console.log(`⚠️ Aucun CV trouvé pour ${row.candidat_prenom} ${row.candidat_nom}`);
      }
      
      return {
        id: row.candidat_id,
        candidature_id: row.candidature_id,
        offre_id: row.offre_id,
        offre_titre: row.offre_titre,
        nom: `${row.candidat_prenom} ${row.candidat_nom}`,
        email: row.candidat_email,
        telephone: row.candidat_telephone,
        domaine: row.candidat_domaine,
        localisation: row.candidat_localisation,
        statut: row.statut,
        date_postulation: row.date_postulation,
        cv_text: cv_text,
        has_cv: !!cvFilename,
        cv_filename: cvFilename,
        extraction_method: cv_text ? (cv_text.length > 0 ? "ocr" : "none") : "none"
      };
    }));

    const withCV = candidatsAvecCV.filter(c => c.has_cv).length;
    const withText = candidatsAvecCV.filter(c => c.cv_text && c.cv_text.length > 0).length;
    console.log(`📊 Résumé: ${withCV} candidats ont un CV, ${withText} ont du texte extrait`);

    res.json(candidatsAvecCV);
  } catch (err) {
    console.error("❌ Erreur récupération candidatures:", err);
    res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
});

// Route de test pour extraire un CV spécifique (à ajouter avant le démarrage du serveur)
app.get("/test-extract-cv/:candidatureId", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const { candidatureId } = req.params;

    const result = await pool.query(
      `SELECT c.cv AS candidature_cv, u.cv AS candidat_cv, u.nom, u.prénom
       FROM candidatures c
       JOIN users u ON c.candidat_id = u.id
       WHERE c.id = $1`,
      [candidatureId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Candidature non trouvée" });
    }

    const row = result.rows[0];
    const cvFilename = row.candidature_cv || row.candidat_cv;
    
    if (!cvFilename) {
      return res.json({ 
        success: false, 
        message: "Aucun CV trouvé pour cette candidature",
        cv_filename: null 
      });
    }

    const cvPath = path.join(__dirname, 'uploads', cvFilename);
    
    try {
      await fs.access(cvPath);
      const dataBuffer = await fs.readFile(cvPath);
      const pdfData = await pdfParse(dataBuffer);
      
      res.json({
        success: true,
        cv_filename: cvFilename,
        cv_path: cvPath,
        text_length: pdfData.text.length,
        text_preview: pdfData.text.substring(0, 500),
        full_text: pdfData.text
      });
    } catch (err) {
      res.json({
        success: false,
        cv_filename: cvFilename,
        cv_path: cvPath,
        error: err.message
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Route pour lister les CVs dans le dossier uploads
app.get("/list-cvs", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const uploadDir = path.join(__dirname, 'uploads');
    const files = await fs.readdir(uploadDir);
    
    res.json({
      upload_dir: uploadDir,
      files: files,
      count: files.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE CV
app.delete("/delete-cv", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    await pool.query(
      "UPDATE users SET cv = NULL WHERE id = $1",
      [req.user.id]
    );

    res.json({ 
      success: true, 
      message: "CV supprimé avec succès" 
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET fichier uploadé
app.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;
  const filepath = path.join(__dirname, "uploads", filename);
  res.sendFile(filepath);
});

// GET stats profil
app.get("/profile/stats", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userResult = await pool.query(
      "SELECT nom, prénom, email, téléphone, domaine, localisation, cv FROM users WHERE id = $1",
      [userId]
    );
    
    const user = userResult.rows[0];
    
    let count = 0;
    const total = 7;
    if (user.nom) count++;
    if (user.prénom) count++;
    if (user.email) count++;
    if (user.téléphone) count++;
    if (user.localisation) count++;
    if (user.domaine) count++;
    if (user.cv) count++;
    
    const progression = Math.round((count / total) * 100);
    
    res.json({
      progression,
      hasCV: !!user.cv
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =============================================
// ROUTES POUR LES CANDIDATURES (RECRUTEUR) - VERSION UNIQUE
// =============================================

// GET - Récupérer toutes les candidatures pour les offres d'un recruteur
app.get("/recruteur/candidatures", verifyToken, async (req, res) => {
  console.log("🚀 ~ req:", req)
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    const result = await pool.query(
      `SELECT 
        c.id AS candidature_id,
        c.statut,
        c.date_postulation,
        c.cv,
        o.id AS offre_id,
        o.titre AS offre_titre,
        u.id AS candidat_id,
        u.nom AS candidat_nom,
        u.prénom AS candidat_prenom,
        u.email AS candidat_email,
        u.téléphone AS candidat_telephone,
        u.domaine AS candidat_domaine,
        u.localisation AS candidat_localisation
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON c.candidat_id = u.id
       WHERE o.recruteur_id = $1
       ORDER BY c.date_postulation DESC`,
      [recruteurId]
    );

    // Convertir les statuts en format lisible pour l'affichage
    const statutMapping = {
      'EN_ATTENTE': 'EN ATTENTE',
      'EN_COURS': 'EN COURS',
      'ACCEPTE': 'ACCEPTÉE',
      'REFUSE': 'REFUSÉE'
    };

    const candidaturesFormatees = result.rows.map(c => ({
      ...c,
      statut: statutMapping[c.statut] || c.statut
    }));

    res.json(candidaturesFormatees);
  } catch (err) {
    console.error("Erreur récupération candidatures:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =============================================
// ROUTES POUR LES NOTIFICATIONS
// =============================================

// GET - Récupérer les notifications d'un candidat
app.get("/notifications", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès réservé aux candidats" });
    }

    const candidatId = req.user.id;

    const result = await pool.query(
      `SELECT 
        n.id,
        n.message,
        n.type,
        n.est_lu,
        n.date_creation,
        c.id AS candidature_id,
        c.statut AS nouveau_statut,
        o.id AS offre_id,
        o.titre AS offre_titre,
        u.nom AS recruteur_nom,
        u.prénom AS recruteur_prenom
       FROM notifications n
       JOIN candidatures c ON n.candidature_id = c.id
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON o.recruteur_id = u.id
       WHERE n.candidat_id = $1
       ORDER BY n.date_creation DESC
       LIMIT 50`,
      [candidatId]
    );

    const statutMapping = {
      'EN_ATTENTE': 'EN ATTENTE',
      'EN_COURS': 'EN COURS',
      'ACCEPTE': 'ACCEPTÉE',
      'REFUSE': 'REFUSÉE'
    };

    const notificationsFormatees = result.rows.map(n => ({
      ...n,
      nouveau_statut: statutMapping[n.nouveau_statut] || n.nouveau_statut
    }));

    res.json(notificationsFormatees);
  } catch (err) {
    console.error("Erreur récupération notifications:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Compter les notifications non lues
app.get("/notifications/non-lues/count", verifyToken, async (req, res) => {
  try {
    const candidatId = req.user.id;

    const result = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE candidat_id = $1 AND est_lu = false",
      [candidatId]
    );

    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error("Erreur comptage notifications:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT - Marquer une notification comme lue
app.put("/notifications/:notificationId/lire", verifyToken, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const candidatId = req.user.id;

    const checkResult = await pool.query(
      "SELECT id FROM notifications WHERE id = $1 AND candidat_id = $2",
      [notificationId, candidatId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Notification non trouvée" });
    }

    await pool.query(
      "UPDATE notifications SET est_lu = true WHERE id = $1",
      [notificationId]
    );

    res.json({ success: true, message: "Notification marquée comme lue" });
  } catch (err) {
    console.error("Erreur mise à jour notification:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});



// PUT - Marquer toutes les notifications comme lues
app.put("/notifications/tout-lire", verifyToken, async (req, res) => {
  try {
    const candidatId = req.user.id;

    await pool.query(
      "UPDATE notifications SET est_lu = true WHERE candidat_id = $1 AND est_lu = false",
      [candidatId]
    );

    res.json({ success: true, message: "Toutes les notifications ont été marquées comme lues" });
  } catch (err) {
    console.error("Erreur mise à jour notifications:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =============================================
// ROUTE PRINCIPALE POUR LA MISE À JOUR DES STATUTS (AVEC NOTIFICATION)
// =============================================

// PUT - Mettre à jour le statut d'une candidature (AVEC NOTIFICATION)
app.put("/recruteur/candidatures/:candidatureId/statut", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const { candidatureId } = req.params;
    const { statut } = req.body;
    const recruteurId = req.user.id;

    // Mapping des statuts (format frontend -> base de données)
    const statutMapping = {
      'EN ATTENTE': 'EN_ATTENTE',
      'EN COURS': 'EN_COURS',
      'ACCEPTÉE': 'ACCEPTE',
      'REFUSÉE': 'REFUSE'
    };
    
    const statutBase = statutMapping[statut];
    if (!statutBase) {
      return res.status(400).json({ 
        error: "Statut invalide. Valeurs acceptées: EN ATTENTE, EN COURS, ACCEPTÉE, REFUSÉE"
      });
    }

    // Vérifier que la candidature appartient au recruteur et récupérer les infos
    const candidatureData = await pool.query(
      `SELECT c.id, c.candidat_id, c.statut as ancien_statut, o.titre as offre_titre,
              u.nom as candidat_nom, u.prénom as candidat_prenom
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON c.candidat_id = u.id
       WHERE c.id = $1 AND o.recruteur_id = $2`,
      [candidatureId, recruteurId]
    );

    if (candidatureData.rows.length === 0) {
      return res.status(404).json({ error: "Candidature non trouvée ou non autorisée" });
    }

    const { candidat_id, ancien_statut, offre_titre, candidat_prenom } = candidatureData.rows[0];

    // Mettre à jour le statut
    await pool.query(
      "UPDATE candidatures SET statut = $1 WHERE id = $2",
      [statutBase, candidatureId]
    );

    // Générer le message de notification personnalisé
    let message = "";
    switch(statutBase) {
      case 'ACCEPTE':
        message = `🎉 Félicitations ${candidat_prenom} ! Votre candidature pour l'offre "${offre_titre}" a été acceptée. Le recruteur vous contactera très prochainement.`;
        break;
      case 'REFUSE':
        message = `💼 Bonjour ${candidat_prenom}, votre candidature pour l'offre "${offre_titre}" n'a malheureusement pas été retenue. Bonne continuation dans vos recherches !`;
        break;
      case 'EN_COURS':
        message = `📋 Bonne nouvelle ${candidat_prenom} ! Votre candidature pour l'offre "${offre_titre}" est en cours d'examen.`;
        break;
      case 'EN_ATTENTE':
        message = `⏳ Votre candidature pour l'offre "${offre_titre}" est en attente de traitement.`;
        break;
      default:
        message = `Le statut de votre candidature pour l'offre "${offre_titre}" a été modifié.`;
    }

    // Ajouter l'ancien statut si pertinent
    if (ancien_statut && ancien_statut !== statutBase && ancien_statut !== 'EN_ATTENTE') {
      const ancienLibelle = {
        'EN_ATTENTE': 'en attente',
        'EN_COURS': 'en cours',
        'ACCEPTE': 'acceptée',
        'REFUSE': 'refusée'
      }[ancien_statut];
      if (ancienLibelle) {
        message += ` (Statut précédent: ${ancienLibelle})`;
      }
    }

    // Envoyer la notification (sauvegarde BDD + Socket.IO temps réel)
    await sendNotification(candidat_id, candidatureId, message, 'STATUT_CHANGE');

    res.json({
      success: true,
      message: "Statut mis à jour avec succès",
      candidature: {
        id: candidatureId,
        statut: statut // Format lisible pour le frontend
      }
    });

  } catch (err) {
    console.error("Erreur mise à jour statut:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// =============================================
// ROUTE DE TEST SOCKET.IO
// =============================================



// =============================================
// DÉMARRAGE DU SERVEUR
// =============================================
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  console.log(`📡 Socket.IO prêt à recevoir des connexions`);
});