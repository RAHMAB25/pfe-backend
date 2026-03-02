// server.js
const express = require("express");
const bcrypt = require("bcrypt");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const pool = require("./db"); // ملف الاتصال بالـ PostgreSQL

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Pour traiter les formulaires

// 🔐 Middleware للتحقق من JWT
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

// 🔹 Configuration multer (UNE SEULE FOIS)
// Configuration multer CORRIGÉE
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    // Créer le dossier s'il n'existe pas
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // IMPORTANT: Préserver l'extension .pdf
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `cv-${uniqueSuffix}.pdf`);
  }
});

// Configuration avec filtrage stricte PDF
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Vérifier le type MIME et l'extension
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'), false);
    }
  },
  limits: { 
    fileSize: 5 * 1024 * 1024 // 5 Mo max
  }
});

// ------------------------
// تسجيل مستخدم جديد (AVEC UPLOAD)
// ------------------------
// ------------------------
// تسجيل مستخدم جديد (AVEC UPLOAD)
// ------------------------
app.post('/adduser', upload.single('cv'), async (req, res) => {
  try {
    const created_at = new Date();
    
    // Multer ajoute les champs texte dans req.body
    const { nom, surname, email, tel, domaine, localisation, mot_de_passe, role } = req.body;
    
    console.log("Données reçues:", req.body);
    
    if (!nom || !surname || !email || !mot_de_passe || !role) {
      return res.status(400).json({ error: "Tous les champs requis" });
    }

    // Vérifier si l'email existe déjà
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Cet email est déjà utilisé" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(mot_de_passe, saltRounds);

    // Chemin du CV si uploadé - CORRECTION ICI
    let cvFilename = null;
    if (req.file) {
      cvFilename = req.file.filename;  
      console.log("CV uploadé:", cvFilename); // Changé de cv à cvFilename
    }

    // Insérer l'utilisateur
    const result = await pool.query(
      `INSERT INTO users
        (nom, prénom, email, téléphone, domaine, localisation, mot_de_passe, role, cv, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nom, prénom, email, role`,
      [nom, surname, email, tel || null, domaine || null, localisation || null, 
       hashedPassword, role, cvFilename, created_at] // Utilisation de cvFilename ici
    );

    res.status(201).json({ 
      success: true, 
      message: "Compte créé avec succès",
      user: result.rows[0] 
    });

  } catch (err) {
    console.log("🚀 ~ err:", err);
    console.error("Erreur serveur:", err.message);
    res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
});
// ------------------------
// Login / vérification
// ------------------------
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
    const match = await bcrypt.compare(mot_de_passe, user.mot_de_passe);

    if (!match) {
      return res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
    }

    // 🔑 إنشاء JWT
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
        role: user.role
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ------------------------
// Ajouter une offre (recruteur seulement)
// ------------------------
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

// ------------------------
// Voir mes offres (recruteur seulement)
// ------------------------
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

// ------------------------
// Supprimer une offre (recruteur seulement)
// ------------------------
app.delete("/deleteoffre/:id", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "RECRUTEUR") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const { id } = req.params;

    // Vérifier que l'offre appartient bien au recruteur
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

// ------------------------
// Modifier une offre (recruteur seulement)
// ------------------------
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

    // Vérifier que l'offre appartient bien au recruteur
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
 
// route pour tous les candidats et recruteurs
app.get("/offres", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT offres.id, offres.titre, offres.description, users.nom AS recruteur_nom " +
      "FROM offres " +
      "JOIN users ON offres.recruteur_id = users.id " +
      "ORDER BY offres.date_creation DESC"
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ------------------------
// Ajouter une candidature (candidat seulement)
// ------------------------
app.post("/postuler/:offreId", verifyToken, (req, res) => {
  // Utiliser upload.single comme middleware avec gestion d'erreur
  upload.single("cv")(req, res, async (err) => {
    try {
      // Logs de débogage
      console.log("=== DÉBOGAGE UPLOAD ===");
      console.log("Headers:", req.headers);
      console.log("Content-Type:", req.headers['content-type']);
      console.log("Body:", req.body);
      console.log("File:", req.file);
      console.log("Params:", req.params);
      console.log("Error multer:", err);
      
      // Gérer les erreurs Multer
      if (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ error: "Erreur d'upload: " + err.message });
        }
        return res.status(400).json({ error: err.message });
      }

      // Vérifier le rôle
      if (req.user.role !== "CANDIDAT") {
        return res.status(403).json({ error: "Seul un candidat peut postuler" });
      }

      const { offreId } = req.params;
      const candidatId = req.user.id;
      console.log("🚀 ~ req:", req.body)
      console.log("🚀 ~ req:", req.file)

      // Vérifier fichier
      if (!req.file) {
        return res.status(400).json({ 
          error: "CV obligatoire (PDF)",
          debug: {
            hasFile: !!req.file,
            contentType: req.headers['content-type'],
            bodyKeys: Object.keys(req.body)
          }
        });
      }

      const cv = req.file.filename;

      // Vérifier doublon
      const check = await pool.query(
        "SELECT 1 FROM candidatures WHERE candidat_id = $1 AND offre_id = $2",
        [candidatId, offreId]
      );

      if (check.rows.length > 0) {
        return res.status(400).json({
          error: "Vous avez déjà postulé à cette offre"
        });
      }

      // Vérifier que l'offre existe
      const offreCheck = await pool.query(
        "SELECT id FROM offres WHERE id = $1",
        [offreId]
      );

      if (offreCheck.rows.length === 0) {
        return res.status(404).json({ error: "Offre non trouvée" });
      }

      // INSERT avec CV
      const result = await pool.query(
        `INSERT INTO candidatures (candidat_id, offre_id, cv, statut, date_postulation)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [candidatId, offreId, cv, "EN_ATTENTE"]
      );

      console.log("Candidature créée avec succès:", result.rows[0]);
      
      res.status(201).json({
        success: true,
        candidature: result.rows[0]
      });

    } catch (err) {
      console.error("ERROR DÉTAILLÉ:", err);
      res.status(500).json({ 
        error: "Erreur serveur", 
        details: err.message,
        stack: err.stack 
      });
    }
  });
});

// ------------------------
// GET profil
// ------------------------
// ------------------------
// GET profil
// ------------------------
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

// ------------------------
// UPDATE profil
// ------------------------
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

// ------------------------
// GET /mescandidatures
// ------------------------
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

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


// POST /upload-cv - Uploader CV depuis le profil
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

// DELETE /delete-cv - Supprimer CV du profil
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


// GET /uploads/:filename - Voir/télécharger CV
app.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;
  const filepath = path.join(__dirname, "uploads", filename);
  res.sendFile(filepath);
});

// GET /profile/stats - Statistiques du profil
app.get("/profile/stats", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userResult = await pool.query(
      "SELECT nom, prénom, email, téléphone, domaine, localisation, cv FROM users WHERE id = $1",
      [userId]
    );
    
    const user = userResult.rows[0];
    
    // Calculer progression
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

// ------------------------ 
// Lancer serveur
// ------------------------
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});