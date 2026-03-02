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








CREATE TABLE candidatures (
    id SERIAL PRIMARY KEY,                
    offre_id INTEGER NOT NULL REFERENCES offres(id) ON DELETE CASCADE,   
    candidat_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, 
    statut VARCHAR(50) DEFAULT 'EN ATTENTE', 
    date_postulation TIMESTAMP DEFAULT CURRENT_TIMESTAMP  
);