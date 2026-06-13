import JobOfferService from '../job.offer.service.js';
import SkillsService from '../skills.service.js';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import pool from '../db.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


class CandidatureController {
    
   static async updateCandidature (req, res) {
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
       
       await CandidatureController.sendNotification(
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
   }

   static async deleteCandidat (req, res){
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
           const cvPath = path.join(__dirname,'..', "uploads", cvResult.rows[0].cv);
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
   }

   static async retrieveMyCandidautes(req, res) {
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
   }

   static async getAllCandidatures (req, res)  {
     const skillsService = new SkillsService()
     const jobOfferService = new JobOfferService()
     try {
       if (req.user.role !== "RECRUTEUR") {
         return res.status(403).json({ error: "Accès réservé aux recruteurs" });
       }
   
       const recruteurId = req.user.id;
       const { id } = req.params;
   
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
          WHERE o.recruteur_id = $1 and c.id = $2
          ORDER BY c.date_postulation DESC`,
         [recruteurId, id]
       );
   
   
       console.log(`📊 ${result.rows.length} candidatures trouvées`);
   
       if (result?.rows) {
   
         const offreDescription = await pool.query(
           "SELECT description FROM offres WHERE id = $1 AND recruteur_id = $2",
           [result?.rows[0]?.offre_id, recruteurId]
         );
   
         let cvText = "Empty cv file text"
         
        if (result?.rows[0]?.candidature_cv) {
         try {
              const cvPath = path.join(__dirname,'..', 'uploads', result?.rows[0]?.candidature_cv);
              
   
            if (fs.existsSync(cvPath)) {
              
               const dataBuffer = await fsPromises.readFile(cvPath);
           
               const parser = new PDFParse({ data: dataBuffer });
           
               cvText = (await parser.getText()).text;

             } else {
               console.log(`❌ Fichier non trouvé: ${cvPath}`);
             }   
     
          } catch (err) {
            console.error('Erreur lecture CV:', err.message);
            res.json([]);
          }
        }
   
         const userSkillsCv = skillsService.extractSkills(cvText)
         const score = jobOfferService.calculateMatchScore(userSkillsCv,offreDescription?.rows[0]?.description )
   
         res.json({
           id: result?.rows[0].candidat_id,
           candidature_id: result?.rows[0].candidature_id,
           offre_id: result?.rows[0].offre_id,
           offre_titre: result?.rows[0].offre_titre,
           nom: `${result?.rows[0].candidat_prenom} ${result?.rows[0].candidat_nom}`,
           email: result?.rows[0].candidat_email,
           telephone: result?.rows[0].candidat_telephone,
           domaine: result?.rows[0].candidat_domaine,
           localisation: result?.rows[0].candidat_localisation,
           statut: result?.rows[0].statut,
           date_postulation: result?.rows[0].date_postulation,
           score
         })
   
       } else {
         console.error(`Not found candidature with this id ${id}`);
         res.json([]);
       }
     } catch (err) {
       console.error("❌ Erreur récupération candidatures:", err);
       res.status(500).json({ error: "Erreur serveur", details: err.message });
     }
   }

   static async getAllRecruiterOffresCandidatures (req, res) {
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
   }

   static async testCvExtarct (req, res) {
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
   
       const cvPath = path.join(__dirname,'..', 'uploads', cvFilename);
       
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
   }

   static async sendNotification(candidatId, candidatureId, message, type) {
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

   static async evaluateCandidature (req, res) {
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
   }
}

export default CandidatureController;