require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const express = require("express");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pdfParse = require('pdf-parse');
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


// Vérifier que la clé API existe
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Erreur: GEMINI_API_KEY manquante dans .env');
  process.exit(1);
}

// Initialiser Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });



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



app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
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
// Dans votre backend, modifiez le mapping des statuts pour être cohérent :
app.get("/mescandidatures", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const result = await pool.query(
      `SELECT c.id AS candidature_id, o.titre AS offre_titre, u.nom AS recruteur_nom,
              c.statut, c.date_postulation, c.cv
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       JOIN users u ON o.recruteur_id = u.id
       WHERE c.candidat_id = $1
       ORDER BY c.date_postulation DESC`,
      [req.user.id]
    );

    // Garder les statuts en anglais pour le traitement (c'est plus propre)
    // Pas besoin de mapper, gardez EN_ATTENTE, ACCEPTE, REFUSE
    res.json(result.rows);
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
            const dataBuffer = await fs.readFile(cvPath);
const pdfData = await pdfParse(dataBuffer);
cv_text = pdfData.text;
            
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



// PUT - Mettre à jour le statut d'une candidature
app.put("/recruteur/candidatures/:candidatureId/statut", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const { candidatureId } = req.params;
    const { statut } = req.body;
    const recruteurId = req.user.id;

    // Vérifier que la candidature appartient à une offre du recruteur
    const checkResult = await pool.query(
      `SELECT c.id, c.candidat_id, o.titre, o.id as offre_id
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       WHERE c.id = $1 AND o.recruteur_id = $2`,
      [candidatureId, recruteurId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Candidature non trouvée ou non autorisée" });
    }

    const candidature = checkResult.rows[0];

    // Mettre à jour le statut
    await pool.query(
      "UPDATE candidatures SET statut = $1 WHERE id = $2",
      [statut, candidatureId]
    );

    // Envoyer une notification au candidat
    const message = `Votre candidature pour l'offre "${candidature.titre}" a été ${statut === 'ACCEPTE' ? 'acceptée' : statut === 'REFUSE' ? 'refusée' : 'mise en attente'}`;
    
    await sendNotification(
      candidature.candidat_id,
      candidatureId,
      message,
      statut === 'ACCEPTE' ? 'acceptation' : statut === 'REFUSE' ? 'refus' : 'attente'
    );

    res.json({ 
      success: true, 
      message: "Statut mis à jour avec succès",
      nouveauStatut: statut
    });

  } catch (err) {
    console.error("Erreur mise à jour statut:", err);
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




app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const conversations = new Map();







// =============================================
// ROUTES POUR LE TABLEAU DE BORD
// =============================================

// GET - Statistiques complètes pour le dashboard candidat
app.get("/dashboard/stats", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès réservé aux candidats" });
    }

    const candidatId = req.user.id;

    // 1. Récupérer les infos du candidat
    const userResult = await pool.query(
      "SELECT nom, prénom, created_at FROM users WHERE id = $1",
      [candidatId]
    );
    const user = userResult.rows[0];

    // 2. Statistiques des candidatures du candidat
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN statut = 'EN_ATTENTE' THEN 1 ELSE 0 END) as en_attente,
        SUM(CASE WHEN statut = 'ACCEPTE' THEN 1 ELSE 0 END) as acceptees,
        SUM(CASE WHEN statut = 'REFUSE' THEN 1 ELSE 0 END) as refusees
       FROM candidatures 
       WHERE candidat_id = $1`,
      [candidatId]
    );
    const stats = statsResult.rows[0];

    // 3. Nombre de notifications non lues
    const notifResult = await pool.query(
      "SELECT COUNT(*) as non_lues FROM notifications WHERE candidat_id = $1 AND est_lu = false",
      [candidatId]
    );
    const notificationsNonLues = parseInt(notifResult.rows[0].non_lues);

    // 4. Top offres les plus demandées (offres où le candidat a postulé)
    const topOffresResult = await pool.query(
      `SELECT 
        o.titre,
        COUNT(c2.id) as total_candidatures
       FROM offres o
       JOIN candidatures c2 ON o.id = c2.offre_id
       WHERE o.id IN (
         SELECT DISTINCT offre_id FROM candidatures WHERE candidat_id = $1
       )
       GROUP BY o.id, o.titre
       ORDER BY total_candidatures DESC
       LIMIT 5`,
      [candidatId]
    );

    // 5. Évolution des candidatures par mois (pour la courbe)
    const evolutionResult = await pool.query(
      `SELECT 
        TO_CHAR(date_postulation, 'YYYY-MM') as mois,
        COUNT(*) as nombre
       FROM candidatures
       WHERE candidat_id = $1
       GROUP BY TO_CHAR(date_postulation, 'YYYY-MM')
       ORDER BY mois ASC
       LIMIT 12`,
      [candidatId]
    );

    // 6. Dernières activités (candidatures récentes)
    const dernieresActivites = await pool.query(
      `SELECT 
        c.date_postulation,
        o.titre as offre_titre,
        c.statut
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       WHERE c.candidat_id = $1
       ORDER BY c.date_postulation DESC
       LIMIT 5`,
      [candidatId]
    );

    // Calculer le temps écoulé depuis l'inscription
    const dateInscription = new Date(user.created_at);
    const maintenant = new Date();
    const joursInscrit = Math.floor((maintenant - dateInscription) / (1000 * 60 * 60 * 24));

    res.json({
      user: {
        nom: user.nom,
        prenom: user.prénom,
        joursInscrit: joursInscrit || 1
      },
      stats: {
        total: parseInt(stats.total || 0),
        enAttente: parseInt(stats.en_attente || 0),
        acceptees: parseInt(stats.acceptees || 0),
        refusees: parseInt(stats.refusees || 0),
        tauxAcceptation: stats.total > 0 ? Math.round((stats.acceptees / stats.total) * 100) : 0
      },
      notificationsNonLues,
      topOffres: topOffresResult.rows,
      evolution: evolutionResult.rows,
      dernieresActivites: dernieresActivites.rows
    });

  } catch (err) {
    console.error("Erreur dashboard stats:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
// =============================================
// ROUTE - Top offres avec nombre de candidats (pour le dashboard candidat)
// =============================================
app.get("/dashboard/top-offres-candidats", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "CANDIDAT") {
      return res.status(403).json({ error: "Accès réservé aux candidats" });
    }

    const candidatId = req.user.id;

    // Récupérer les offres où le candidat a postulé, avec le nombre total de candidats sur chaque offre
    const result = await pool.query(
      `SELECT 
        o.id AS offre_id,
        o.titre AS offre_titre,
        COUNT(DISTINCT c2.candidat_id) AS total_candidats,
        CASE 
          WHEN c1.statut = 'EN_ATTENTE' THEN 'En attente'
          WHEN c1.statut = 'ACCEPTE' THEN 'Acceptée'
          WHEN c1.statut = 'REFUSE' THEN 'Refusée'
          ELSE 'En attente'
        END AS mon_statut
       FROM candidatures c1
       JOIN offres o ON c1.offre_id = o.id
       LEFT JOIN candidatures c2 ON o.id = c2.offre_id
       WHERE c1.candidat_id = $1
       GROUP BY o.id, o.titre, c1.statut
       ORDER BY total_candidats DESC`,
      [candidatId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur top offres candidats:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


// =============================================
// ROUTE - SUPPRIMER UN COMPTE CANDIDAT
// =============================================
app.delete("/delete-account", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Vérifier que l'utilisateur existe
    const userCheck = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Démarrer une transaction pour garantir la suppression complète
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // 1. Supprimer les notifications liées au candidat
      await client.query(
        "DELETE FROM notifications WHERE candidat_id = $1",
        [userId]
      );

      // 2. Supprimer les candidatures du candidat
      await client.query(
        "DELETE FROM candidatures WHERE candidat_id = $1",
        [userId]
      );

      // 3. Si c'est un recruteur, supprimer ses offres
      if (userRole === "RECRUTEUR") {
        await client.query(
          "DELETE FROM offres WHERE recruteur_id = $1",
          [userId]
        );
      }

      // 4. Supprimer le fichier CV si existe
      const cvResult = await client.query(
        "SELECT cv FROM users WHERE id = $1",
        [userId]
      );
      
      if (cvResult.rows[0]?.cv) {
        const cvPath = path.join(__dirname, "uploads", cvResult.rows[0].cv);
        try {
          await fs.unlink(cvPath);
          console.log(`🗑️ CV supprimé: ${cvPath}`);
        } catch (err) {
          console.log(`⚠️ Fichier CV non trouvé: ${cvPath}`);
        }
      }

      // 5. Supprimer l'utilisateur
      await client.query(
        "DELETE FROM users WHERE id = $1",
        [userId]
      );

      await client.query('COMMIT');
      
      console.log(`✅ Compte utilisateur ${userId} supprimé avec succès`);
      res.json({ 
        success: true, 
        message: "Votre compte a été supprimé avec succès" 
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error("❌ Erreur suppression compte:", err);
    res.status(500).json({ 
      error: "Erreur lors de la suppression du compte",
      details: err.message 
    });
  }
});


// =============================================
// ROUTES POUR LE TABLEAU DE BORD RECRUTEUR AMÉLIORÉ
// =============================================

// GET - Récupérer toutes les offres du recruteur avec statistiques détaillées
app.get("/recruteur/offres-analyse", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    // Récupérer toutes les offres du recruteur
    const offresResult = await pool.query(
      `SELECT 
        o.id, 
        o.titre, 
        o.description, 
        o.date_creation,
        COUNT(DISTINCT c.id) as total_candidatures,
        COUNT(DISTINCT CASE WHEN c.statut = 'EN_ATTENTE' THEN c.id END) as en_attente,
        COUNT(DISTINCT CASE WHEN c.statut = 'ACCEPTE' THEN c.id END) as acceptees,
        COUNT(DISTINCT CASE WHEN c.statut = 'REFUSE' THEN c.id END) as refusees
       FROM offres o
       LEFT JOIN candidatures c ON o.id = c.offre_id
       WHERE o.recruteur_id = $1
       GROUP BY o.id, o.titre, o.description, o.date_creation
       ORDER BY o.date_creation DESC`,
      [recruteurId]
    );

    // Calculer le taux d'acceptation pour chaque offre
    const offresAvecStats = offresResult.rows.map(offre => ({
      ...offre,
      taux_acceptation: offre.total_candidatures > 0 
        ? Math.round((offre.acceptees / offre.total_candidatures) * 100) 
        : 0
    }));

    res.json(offresAvecStats);
  } catch (err) {
    console.error("Erreur récupération offres analyse:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Top offres les plus demandées (pour un recruteur)
app.get("/recruteur/top-offres", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    const result = await pool.query(
      `SELECT 
        o.id,
        o.titre,
        COUNT(c.id) as total_candidatures,
        COUNT(CASE WHEN c.statut = 'ACCEPTE' THEN 1 END) as acceptees
       FROM offres o
       LEFT JOIN candidatures c ON o.id = c.offre_id
       WHERE o.recruteur_id = $1
       GROUP BY o.id, o.titre
       ORDER BY total_candidatures DESC
       LIMIT 5`,
      [recruteurId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur top offres:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Offres les moins demandées (pour un recruteur)
app.get("/recruteur/bottom-offres", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    const result = await pool.query(
      `SELECT 
        o.id,
        o.titre,
        COUNT(c.id) as total_candidatures,
        COUNT(CASE WHEN c.statut = 'ACCEPTE' THEN 1 END) as acceptees
       FROM offres o
       LEFT JOIN candidatures c ON o.id = c.offre_id
       WHERE o.recruteur_id = $1
       GROUP BY o.id, o.titre
       ORDER BY total_candidatures ASC
       LIMIT 5`,
      [recruteurId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur bottom offres:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Évolution des candidatures par mois pour un recruteur
app.get("/recruteur/evolution-candidatures", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    const result = await pool.query(
      `SELECT 
        TO_CHAR(c.date_postulation, 'YYYY-MM') as mois,
        COUNT(*) as nombre_candidatures,
        COUNT(CASE WHEN c.statut = 'ACCEPTE' THEN 1 END) as acceptees
       FROM candidatures c
       JOIN offres o ON c.offre_id = o.id
       WHERE o.recruteur_id = $1
       GROUP BY TO_CHAR(c.date_postulation, 'YYYY-MM')
       ORDER BY mois ASC
       LIMIT 12`,
      [recruteurId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erreur évolution candidatures:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Statistiques globales pour le dashboard recruteur
app.get("/recruteur/stats-globales", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;

    // Statistiques globales
    const statsResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM offres WHERE recruteur_id = $1) as total_offres,
        (SELECT COUNT(*) FROM candidatures c 
         JOIN offres o ON c.offre_id = o.id 
         WHERE o.recruteur_id = $1) as total_candidatures,
        (SELECT COUNT(*) FROM candidatures c 
         JOIN offres o ON c.offre_id = o.id 
         WHERE o.recruteur_id = $1 AND c.statut = 'EN_ATTENTE') as en_attente,
        (SELECT COUNT(*) FROM candidatures c 
         JOIN offres o ON c.offre_id = o.id 
         WHERE o.recruteur_id = $1 AND c.statut = 'ACCEPTE') as acceptees,
        (SELECT COUNT(*) FROM candidatures c 
         JOIN offres o ON c.offre_id = o.id 
         WHERE o.recruteur_id = $1 AND c.statut = 'REFUSE') as refusees`,
      [recruteurId]
    );

    const stats = statsResult.rows[0];
    
    // Calculer le taux d'acceptation global
    const tauxAcceptation = stats.total_candidatures > 0 
      ? Math.round((stats.acceptees / stats.total_candidatures) * 100) 
      : 0;

    // Moyenne de candidatures par offre
    const moyenneCandidatures = stats.total_offres > 0 
      ? (stats.total_candidatures / stats.total_offres).toFixed(1) 
      : 0;

    res.json({
      total_offres: parseInt(stats.total_offres),
      total_candidatures: parseInt(stats.total_candidatures),
      en_attente: parseInt(stats.en_attente),
      acceptees: parseInt(stats.acceptees),
      refusees: parseInt(stats.refusees),
      taux_acceptation: tauxAcceptation,
      moyenne_candidatures_par_offre: parseFloat(moyenneCandidatures)
    });
  } catch (err) {
    console.error("Erreur stats globales:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET - Analyse détaillée d'une offre spécifique
app.get("/recruteur/offre-analyse/:offreId", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès réservé aux recruteurs" });
    }

    const recruteurId = req.user.id;
    const { offreId } = req.params;

    // Vérifier que l'offre appartient au recruteur
    const offreCheck = await pool.query(
      "SELECT id, titre, description FROM offres WHERE id = $1 AND recruteur_id = $2",
      [offreId, recruteurId]
    );

    if (offreCheck.rows.length === 0) {
      return res.status(404).json({ error: "Offre non trouvée ou non autorisée" });
    }

    // Statistiques détaillées de l'offre
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) as total_candidatures,
        COUNT(CASE WHEN statut = 'EN_ATTENTE' THEN 1 END) as en_attente,
        COUNT(CASE WHEN statut = 'ACCEPTE' THEN 1 END) as acceptees,
        COUNT(CASE WHEN statut = 'REFUSE' THEN 1 END) as refusees,
        MIN(date_postulation) as premiere_candidature,
        MAX(date_postulation) as derniere_candidature
       FROM candidatures
       WHERE offre_id = $1`,
      [offreId]
    );

    const stats = statsResult.rows[0];
    const tauxAcceptation = stats.total_candidatures > 0 
      ? Math.round((stats.acceptees / stats.total_candidatures) * 100) 
      : 0;

    // Récupérer les candidats pour cette offre
    const candidatsResult = await pool.query(
      `SELECT 
        u.id,
        u.nom,
        u.prénom,
        u.email,
        u.téléphone,
        c.statut,
        c.date_postulation,
        c.cv
       FROM candidatures c
       JOIN users u ON c.candidat_id = u.id
       WHERE c.offre_id = $1
       ORDER BY c.date_postulation DESC`,
      [offreId]
    );

    res.json({
      offre: offreCheck.rows[0],
      statistiques: {
        total: parseInt(stats.total_candidatures),
        en_attente: parseInt(stats.en_attente),
        acceptees: parseInt(stats.acceptees),
        refusees: parseInt(stats.refusees),
        taux_acceptation: tauxAcceptation,
        premiere_candidature: stats.premiere_candidature,
        derniere_candidature: stats.derniere_candidature
      },
      candidats: candidatsResult.rows
    });
  } catch (err) {
    console.error("Erreur analyse offre:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


// =============================================
// ROUTE CHAT - Version avec réponses prédéfinies (fonctionne sans API)
// =============================================
app.post('/chat', async (req, res) => {
  console.log('📨 Message reçu:', req.body.message);
  
  const { message } = req.body;
  const msg = message.toLowerCase();
  
  let reply = "";
  
  if (msg.includes("cv") || msg.includes("curriculum")) {
    reply = `📄 **CONSEILS POUR UN BON CV**

**Structure idéale :**
1. En-tête (nom, prénom, coordonnées)
2. Profil professionnel (3-4 lignes)
3. Expériences professionnelles (les plus récentes)
4. Formation et diplômes
5. Compétences techniques et soft skills
6. Langues
7. Centres d'intérêt

**À faire :**
✅ Personnalisez selon l'offre
✅ Utilisez des chiffres et résultats
✅ Soignez la présentation (1 page max)

**À éviter :**
❌ Fautes d'orthographe
❌ Photo (sauf demande)
❌ Trop de texte

💡 **Astuce :** Adaptez votre CV à chaque candidature !`;
  }
  else if (msg.includes("entretien")) {
    reply = `🎯 **PRÉPARER UN ENTRETIEN D'EMBAUCHE**

**Avant :**
1. 🔍 Recherchez l'entreprise
2. 📋 Relisez l'offre et votre CV
3. 🎤 Préparez un pitch de 2 minutes
4. ❓ Préparez 3-4 questions

**Questions fréquentes :**
• "Parlez-moi de vous"
• "Vos forces/faiblesses ?"
• "Pourquoi nous ?"

**Le jour J :**
• Arrivez 10 min en avance
• Tenez-vous droit
• Prenez le temps de répondre

💡 **Astuce :** Entraînez-vous devant un miroir !`;
  }
  else if (msg.includes("salaire") || msg.includes("négocier")) {
    reply = `💰 **NÉGOCIER SON SALAIRE**

**Préparation :**
1. Renseignez-vous sur les salaires du secteur
2. Calculez votre salaire idéal
3. Listez vos arguments

**Pendant :**
• Laissez l'employeur proposer en premier
• Mettez en avant votre valeur
• Restez professionnel

**Exemple :**
"Au vu de mon expérience, je vise une fourchette entre X et Y €"

💡 **Astuce :** Négociez aussi les avantages !`;
  }
  else if (msg.includes("lettre") || msg.includes("motivation")) {
    reply = `✉️ **LETTRE DE MOTIVATION**

**Structure :**

[Vos coordonnées]
[Date]

**Objet :** Candidature au poste de [titre]

Madame, Monsieur,

**Paragraphe 1** - Présentation et poste visé
**Paragraphe 2** - Vos compétences
**Paragraphe 3** - Pourquoi cette entreprise ?
**Paragraphe 4** - Formule de politesse

💡 **Astuce :** Personnalisez chaque lettre !`;
  }
  else {
    reply = `🤖 **Assistant Recrutement**

Bonjour ! Je suis votre assistant spécialisé en recrutement.

📋 **Je peux vous aider sur :**
• **CV** - Comment rédiger un CV efficace
• **Entretien** - Préparer vos entretiens
• **Salaire** - Négocier votre rémunération
• **Lettre** - Lettre de motivation

💬 **Posez-moi une question comme :**
- "Comment rédiger un bon CV ?"
- "Préparer un entretien d'embauche"
- "Comment négocier mon salaire ?"

Je suis là pour vous aider ! 😊`;
  }
  
  console.log('✅ Réponse générée');
  res.json({ reply: reply });
});


// Route de test
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', gemini: 'ready' });
});



// =============================================
// DÉMARRAGE DU SERVEUR
// =============================================
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
  console.log(`📡 Socket.IO prêt à recevoir des connexions`);
});

