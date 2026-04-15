create database REC;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    Nom VARCHAR(100) NOT NULL,
    Prénom VARCHAR(100) NOT NULL,
    Email VARCHAR(150) UNIQUE NOT NULL,
    Téléphone VARCHAR(20),
    Domaine VARCHAR(100),
    Localisation VARCHAR(100),
    Mot de passe VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('RECRUTEUR', 'CANDIDAT')) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);




 CREATE TABLE IF NOT EXISTS public.offres
(
    id integer NOT NULL DEFAULT nextval('offres_id_seq'::regclass),
    recruteur_id integer NOT NULL,
    titre character varying(255) COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    date_creation timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(50) COLLATE pg_catalog."default" DEFAULT 'active'::character varying,
    CONSTRAINT offres_pkey PRIMARY KEY (id)
)




CREATE TABLE candidatures (
    id SERIAL PRIMARY KEY,                
    offre_id INTEGER NOT NULL REFERENCES offres(id) ON DELETE CASCADE,   
    candidat_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
    statut VARCHAR(50) DEFAULT 'EN ATTENTE', 
    date_postulation TIMESTAMP DEFAULT CURRENT_TIMESTAMP  
);


CREATE INDEX idx_notifications_non_lues ON notifications(candidat_id, est_lu) WHERE est_lu = false;CREATE
  TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    candidat_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidature_id INTEGER NOT NULL REFERENCES candidatures(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    est_lu BOOLEAN DEFAULT false,
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_candidat ON notifications(candidat_id);
CREATE INDEX idx_notifications_candidature ON notifications(candidature_id);
CREATE INDEX idx_notifications_date ON notifications(date_creation DESC);


CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  candidat_id INT,
  sender VARCHAR(10),
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);