import JobOfferService from '../job.offer.service.js';
import MessageService from '../message.service.js';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import pool from '../db.js';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChatController {

  // Stocker l'historique de conversation par utilisateur
   static conversations = new Map();
    
   static async chat (req, res) {
   

      try {
        if (req.user.role !== 'CANDIDAT') {
          return res.status(403).json({ error: 'Accès réservé aux candidats' });
        }
    
        const { message } = req.body;
        const candidatId = req.user.id;
    
        if (!message || !message.trim()) {
          return res.status(400).json({ error: 'Message vide' });
        }
    
    
    
        // ── 1. Récupérer le CV du candidat ──────────────────────────
        const userResult = await pool.query(
          'SELECT nom, prénom, domaine, localisation, cv FROM users WHERE id = $1',
          [candidatId]
        );
        const user = userResult.rows[0];
    
        let cvText = 'Aucun CV uploadé.';
    
        if (user?.cv) {
          try {
               const cvPath = path.join(__dirname,'..','uploads', user.cv);
    
               if (fs.existsSync(cvPath)) {
       
                const dataBuffer = await fsPromises.readFile(cvPath);

                const parser = new PDFParse({ data: dataBuffer });

                cvText = (await parser.getText()).text;
            }    
      
          } catch (err) {
            console.error('Erreur lecture CV:', err.message);
          }
        }
        
        // 2. Find Matching Jobs
        const offresResult = await pool.query(
          `SELECT id, titre, description 
           FROM offres 
           ORDER BY date_creation DESC 
           LIMIT 20`
        );
        
        const messageService = new MessageService()
    
        const intent = messageService.detectIntent(message);
    
        let matchingJobs;
        let offresTexte = "Je n'ai pas compris votre demande. Je suis uniquement là pour vous aider à trouver des offres d'emploi adaptées à votre profil. Merci de préciser votre recherche.";
    
        const jobOfferService = new JobOfferService()
    
        switch(intent) {    
          case "JOB_SEARCH":
             matchingJobs = jobOfferService.getMatchingJobs(cvText, offresResult);
             break;
        }
    
        // ── 3. offers that match demand ───────────────
        if (Array.isArray(matchingJobs)) {
          offresTexte = matchingJobs.length > 0 ? matchingJobs.map(job => job.titre.trim()).join('\n') : 'Aucune offre disponible pour le moment.';
        }
    
        // ── 5. Gérer l'historique de conversation ───────────────────
        if (!ChatController.conversations.has(candidatId)) {
          ChatController.conversations.set(candidatId, []);
        }
        const history = ChatController.conversations.get(candidatId);
    
        // Limiter l'historique à 10 messages pour éviter de dépasser le contexte
        if (history.length > 10) {
          history.splice(0, history.length - 10);
        }
    
        history.push({ role: 'user', content: message });
    
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    
        res.write(`data: ${offresTexte}`);
        res.end();
    
      } catch (err) {
        console.error('❌ Erreur chat GPT-4:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erreur serveur', details: err.message });
        }
      }
   }    

   static async deleteHisto (req, res) {
     ChatController.conversations.delete(req.user.id);
     res.json({ success: true, message: 'Conversation réinitialisée' });
    } 
}

export default ChatController;