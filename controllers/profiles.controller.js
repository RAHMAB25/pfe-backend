import { upload } from "../common.js";
import path from "path";
import { promises as fs } from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt'
import pool from "../db.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


class ProfilesController {
    
   static async getStatProfile (req, res)  {
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
   }    

   static async login(req, res) {
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
    
        // MODIFIER ICI - Ajouter nom et prénom dans le token
        const token = jwt.sign(
          { 
            id: user.id, 
            role: user.role,
            nom: user.nom,        // Ajouté
            prenom: user.prénom   // Ajouté
          },
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
   } 
   
   static async getProfile (req, res) {
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
   }

   static async updateProfile (req, res) {
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
   }

   static async uploadCV (req, res) {
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
          hashedPassword, role, cvFilename || null, created_at]
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
   }

   static async cvList (req, res){
     try {
       if (req.user.role !== "RECRUTEUR") {
         return res.status(403).json({ error: "Accès refusé" });
       }
   
       const uploadDir = path.join(__dirname,'..', 'uploads');
       const files = await fs.readdir(uploadDir);
       
       res.json({
         upload_dir: uploadDir,
         files: files,
         count: files.length
       });
     } catch (err) {
       res.status(500).json({ error: err.message });
     }
   }   

   static async deleteCv (req, res){
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
   }   
   
   static getUploadedFile (req, res){
     const { filename } = req.params;
     const filepath = path.join(__dirname,'..', "uploads", filename);
     res.sendFile(filepath);
   }
}

export default ProfilesController;