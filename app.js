/**
 * @file Dies ist die Hauptanwendungsdatei für den Resource Catalog Service.
 * @description Initialisiert die Express.js-Anwendung, registriert globale Middleware und bindet den Ressourcen-Router ein.
 */

import express from 'express';
import resourcesRouter from './routes/resources.js'; // Importiert den Ressourcen-Router
import { errorHandler } from './middleware/error-handler.js'; // Importiert die globale Fehlerbehandlungs-Middleware
import { logger } from './middleware/logger.js'; // Importiert die Logging-Middleware
import 'dotenv/config'; // Importiert und konfiguriert dotenv, um Umgebungsvariablen aus der .env-Datei zu laden.
import cors from 'cors'; // Importiert das CORS-Middleware-Paket.
import { connectDB } from './db/connect.js';

/**
 * @constant {number} PORT - Der Port, auf dem der Server lauschen soll.
 * Wird aus den Umgebungsvariablen (`process.env.PORT`) gelesen oder auf 5002 als Standardwert gesetzt.
 */
const PORT = process.env.PORT || 5002;

/**
 * @constant {express.Application} app - Die Express.js-Anwendungsinstanz.
 */
const app = express();

/**
 * @section Globale Middleware
 * @description Registriert globale Middleware, die für jede eingehende Anfrage ausgeführt wird.
 */

/**
 * @middleware {Function} logger - Protokolliert Details jeder eingehenden HTTP-Anfrage.
 * Muss vor anderen Routen oder Middleware platziert werden, um alle Anfragen abzufangen.
 */
app.use(logger);

/**
 * @middleware {Function} express.json - Parst eingehende Anfragen mit JSON-Payloads.
 * Macht JSON-Daten im Request-Body über `req.body` zugänglich.
 */
app.use(express.json());

/**
 * @middleware {Function} cors - Aktiviert Cross-Origin Resource Sharing (CORS).
 * Erlaubt Anfragen von verschiedenen Ursprüngen (Domains) an diesen Server.
 * Dies ist wichtig für die Frontend-Backend-Kommunikation.
 */
app.use(cors());

/**
 * @section Datenbankverbindung
 * @description Registriert die Datenbank.
 */

if (!process.env.MONGO_URI) {
    console.warn("[MongoDB] MONGO_URI nicht gesetzt - ohne DB keine Persistenz.");
    process.exit(1);
} else {
    await connectDB(process.env.MONGO_URI,
        { dbName: process.env.MONGO_DB || "resource_catalog" }
    );
}

/**
 * @section Routen
 * @description Registriert den Ressourcen-Router.
 */

// Dummy-Route für den Root-Pfad zur Überprüfung der Service-Erreichbarkeit
app.get('/', (req, res) => {
    res.send('Hello from Resource Catalog Service!');
});

/**
 * @route {string} /resources - Basispfad für alle Ressourcen-API-Endpunkte.
 * @middleware {express.Router} resourcesRouter - Der Router, der alle Endpunkte für Ressourcen, Bewertungen und Feedback behandelt.
 */
app.use('/resources', resourcesRouter);

/**
 * @section Fehlerbehandlung
 * @description Registriert eine globale Fehlerbehandlungs-Middleware.
 */

/**
 * @middleware {Function} errorHandler - Globale Fehlerbehandlungs-Middleware.
 * Diese Middleware sollte zuletzt registriert werden, um alle Fehler abzufangen,
 * die in den vorherigen Routen oder Middleware auftreten.
 * Sie sorgt für eine konsistente Fehlerantwort (`500 Internal Server Error`).
 */
app.use(errorHandler);

/**
 * Startet den Express.js-Server auf dem konfigurierten Port.
 * @listens PORT
 */
app.listen(PORT, () => {
    console.log(`Resource Catalog Service läuft auf http://localhost:${PORT}`);
});

