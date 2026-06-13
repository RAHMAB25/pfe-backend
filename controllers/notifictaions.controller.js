import pool from "../db.js";

class CandidatNotificationsController {
    
  static async getCandidatNotifications (req, res) {
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
  }
 static async conmpareNotReadedNotifications (req, res)  {
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
 }

 static async markANotificationAsRead (req, res) {
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
 }

 static async markAllNotificationAsRead (req, res) {
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
}
}

export default CandidatNotificationsController;