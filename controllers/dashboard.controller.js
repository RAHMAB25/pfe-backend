import pool from "../db.js";

class DashboardController {
    
   static async getstats(req, res) {
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
   }

   static async getTopOfferForCandidat (req, res) {
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
   }

   static async overallStatistics (req, res) {
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
   }
}

export default DashboardController;