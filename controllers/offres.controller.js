import pool from '../db.js'
import { PDFParse } from "pdf-parse";
import path from "path";
import { upload } from "../common.js"
import JobOfferService from "../job.offer.service.js";
import SkillsService from "../skills.service.js";
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class OffresController {
    
   static async getAllRecruitersOffers(req, res) {
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
   }

   static async mostRequestedOffers (req, res){
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
   }

   static async leastRequestedOffers (req, res) {
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
   }

   static async hasCandidateAppliedToJob (req, res) {
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
   }

   static applyForJob(req, res)  {
    const skillsService = new SkillsService()
    const jobOfferService = new JobOfferService()

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
         const offreDescription = await pool.query("SELECT description FROM offres WHERE id = $1",[offreId]);
    
         if (!offreId) {
           return res.status(400).json({ error: "ID de l'offre manquant" });
         }
   
         const candidatId = req.user.id;
   
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
   }

   static async uploadCvFromProfile (req, res){
    let cvToText = "";
  
   
     try {
       if (req.user.role !== "CANDIDAT") {
         return res.status(403).json({ error: "Accès refusé" });
       }
   
       if (!req.file) {
         return res.status(400).json({ error: "Fichier CV requis" });
       }

      const cvPath = path.join(__dirname,'..', 'uploads', req.file.filename);
                    
         
      if (fs.existsSync(cvPath)) {
        
         const dataBuffer = await fsPromises.readFile(cvPath);
      
         const parser = new PDFParse({ data: dataBuffer });
      
         cvToText = (await parser.getText()).text
       } else {
         console.log(`❌ Fichier non trouvé: ${cvPath}`);
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
   }

   static async addOffer(req, res) {
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
   }

   static async showOffer (req, res) {
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
    } 

    static async deleteOffer (req, res) {
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
     } 
     
     static async updateOffer (req, res) {
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
     }    
     
     static  async showAllOffer (req, res)  {
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
      }     
      
      static async analyzeJobOffer (req, res) {
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
 }
}   

export default OffresController;