/**
 * @file Dieser Router verwaltet alle API-Endpunkte für Ressourcen, Bewertungen und Feedback
 * im Resource Catalog Service.
 * @description
 * - Bietet CRUD-Operationen auf Ressourcen (Anlegen, Lesen, Aktualisieren, Löschen).
 * - Verwaltet Bewertungen (Ratings) und textbasiertes Feedback zu Ressourcen.
 * - Die Endpunkte liefern je nach Route:
 *   - GET /           → Ressourcen mit `averageRating` (ohne `feedback`)
 *   - GET /:id        → Ressource mit `averageRating` **und** vollständigem `feedback`
 *   - POST/PUT/DELETE → wie dokumentiert unten; Schreib-Endpoints geben angereicherte Ressourcen zurück, wo sinnvoll.
 *
 * Datenspeicher:
 * - `resources.json`: Liste der Ressourcenobjekte.
 * - `ratings.json`  : Liste der Bewertungen (resourceId, ratingValue, userId, timestamp).
 * - `feedback.json` : Liste der Feedback-Einträge (resourceId, feedbackText, userId, timestamp).
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validateResource, validateRating, validateFeedback } from '../middleware/validation.js';
import { readData, writeData } from '../helpers/data_manager.js';
import { buildEnrichedResource } from '../helpers/enrich_resource.js';
import { average } from '../helpers/metrics.js';
import Resource from '../models/resource.js';
import Rating from '../models/rating.js';
import Feedback from '../models/feedback.js';
import { toObjectId, toClient } from '../utils/mongo.js';

const router = express.Router();

const RESOURCES_FILE = 'resources.json';
const RATINGS_FILE   = 'ratings.json';
const FEEDBACK_FILE  = 'feedback.json';

// --- RESOURCE ENDPOINTS ---

/**
 * @route GET /
 * @summary Ruft alle Ressourcen ab (optional gefiltert), **mit durchschnittlicher Bewertung, ohne Feedback**.
 * @description
 * **Ruft eine umfassende Liste aller Ressourcen ab.**
 *
 * Jede Ressource im Response enthält:
 * - Basisdaten (z. B. `id`, `title`, `type`, `authorId`, …)
 * - `averageRating`: den Durchschnitt aller abgegebenen Bewertungen (0, wenn keine vorliegen)
 *
 * **Hinweis:** Diese Route liefert absichtlich **kein** `feedback`-Array, um die Antwort klein zu halten.
 * Für eine vollständige Detailansicht inkl. Feedback nutze **GET /:id**.
 *
 * Optional kann nach Ressourcentyp (`type`) oder Autor (`authorId`) gefiltert werden.
 *
 * @access Public
 * @param {string} [req.query.type] - Optional: Filtert die Ergebnisse nach Ressourcentyp.
 * @param {string} [req.query.authorId] - Optional: Filtert die Ergebnisse nach Autor-ID.
 * @returns {Array<Object>} 200 - Liste aller Ressourcen (angereichert um `averageRating`, ohne `feedback`).
 * @returns {Object} 500 - Interner Serverfehler.
 *
 * @example
 * // Request: GET /resources?type=frontend
 * // Response (200):
 * // [
 * //   {
 * //     "id": "123",
 * //     "title": "React Basics",
 * //     "type": "frontend",
 * //     "authorId": "dev42",
 * //     "averageRating": 4.5
 * //   }
 * // ]
 */
router.get('/', async (req, res, next) => {
  try {
    // const resources = await readData(RESOURCES_FILE);
    // const ratings   = await readData(RATINGS_FILE);

    // const { type, authorId } = req.query;

    // let filtered = resources;
    // if (type)     filtered = filtered.filter(r => String(r.type) === String(type));
    // if (authorId) filtered = filtered.filter(r => String(r.authorId) === String(authorId));

    // // Anreichern NUR mit averageRating (KEIN feedback anhängen)
    // const enriched = filtered.map(resource => {
    //   const resourceId = String(resource.id);
    //   const resourceRatings = ratings.filter(r => String(r.resourceId) === resourceId);
    //   const avgRating = average(resourceRatings.map(r => r.ratingValue));

    //   // explizit KEIN 'feedback' Feld zurückgeben
    //   const { feedback, ...rest } = resource; // falls im Datensatz existiert, entfernen
    //   return {
    //     ...rest,
    //     averageRating: avgRating
    //   };
    // });

    // res.status(200).json(enriched);

    const resources = await Resource.find().lean();

    const ratingAgg = await Rating.aggregate([
      { $group: { _id: "$resourceId", avg: { $avg: "$ratingValue" } } }
    ]);

    const avgMap = Object.fromEntries(
      ratingAgg.map((res) => [String(res._id), Number(res.avg?.toFixed(2) ?? 0)])
    );

    const enriched = resources.map((resource_doc) => {
      const id = String(resource_doc._id);
      const resource_obj = toClient(resource_doc);
      return {
        ...resource_obj,
        averageRating: avgMap[id] ?? 0
      };
    });

    res.status(200).json(enriched);
    
  } catch (error) {
    console.error('Fehler beim Abrufen aller Ressourcen:', error);
    next(error);
  }
});

/**
 * @route GET /:id
 * @summary Ruft eine einzelne Ressource anhand ihrer ID ab, **mit durchschnittlicher Bewertung und vollständigem Feedback**.
 * @description
 * **Ruft eine Ressource by ID ab** und liefert:
 * - alle Basisinformationen der Ressource
 * - `averageRating`: den Durchschnitt aller Bewertungen
 * - `feedback`: alle zugehörigen Feedback-Einträge
 *
 * Falls keine Ressource mit der angegebenen ID existiert, wird `404 Not Found` zurückgegeben.
 *
 * @access Public
 * @param {string} req.params.id - Die ID der abzurufenden Ressource.
 * @returns {Object} 200 - Ressource mit `averageRating` und `feedback`.
 * @returns {Object} 404 - Ressource nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 *
 * @example
 * // Request: GET /resources/123
 * // Response (200): {
 * //   "id": "123",
 * //   "title": "React Basics",
 * //   "type": "frontend",
 * //   "averageRating": 4.2,
 * //   "feedback": [
 * //     { "id": "f1", "resourceId": "123", "feedbackText": "Tolle Einführung!", "userId": "tom", "timestamp": "2025-08-20T09:00:00Z" }
 * //   ]
 * // }
 */
router.get('/:id', async (req, res, next) => {
  try {
    const resourceId = req.params.id;

    const resources = await readData(RESOURCES_FILE);
    const ratings   = await readData(RATINGS_FILE);
    const feedback  = await readData(FEEDBACK_FILE);

    const resource = resources.find(r => String(r.id) === String(resourceId));
    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    // Hier voll anreichern (averageRating + feedback)
    const enriched = buildEnrichedResource(resource, ratings, feedback);
    res.status(200).json(enriched);
  } catch (error) {
    console.error(`Fehler beim Abrufen der Ressource mit ID ${req.params.id}:`, error);
    next(error);
  }
});

/**
 * @route POST /
 * @summary Erstellt eine neue Ressource.
 * @description
 * Nimmt Ressourcendaten im Request-Body entgegen, generiert eine UUID und speichert die Ressource.
 * Die Antwort enthält die neu erstellte Ressource (ohne Ratings/Feedback, da noch nicht vorhanden).
 *
 * Validierung erfolgt über die `validateResource`-Middleware.
 *
 * @access Public
 * @param {Object} req.body - Die Daten der neuen Ressource (z. B. { title, type, authorId, ... }).
 * @returns {Object} 201 - Das neu erstellte Ressourcenobjekt.
 * @returns {Object} 400 - Ungültige oder fehlende Ressourcendaten.
 * @returns {Object} 500 - Interner Serverfehler.
 */
router.post('/', validateResource, async (req, res, next) => {
  const newResourceData = req.body;

  const newResource = {
    id: uuidv4(),
    ...newResourceData,
    createdAt: new Date().toISOString()
  };

  try {
    const resources = await readData(RESOURCES_FILE);
    resources.push(newResource);
    await writeData(RESOURCES_FILE, resources);
    res.status(201).json(newResource);
  } catch (error) {
    console.error('Fehler beim Erstellen einer Ressource:', error);
    next(error);
  }
});

/**
 * @route PUT /:id
 * @summary Aktualisiert eine bestehende Ressource vollständig oder teilweise
 *          **und gibt die angereicherte Ressource zurück**.
 * @description
 * Nimmt die Ressourcen-ID aus den Parametern und die zu aktualisierenden Daten im Body entgegen.
 * Antwortet mit der **aktualisierten Ressource**, angereichert um `averageRating` & `feedback`.
 *
 * @access Public
 * @param {string} req.params.id - Die ID der zu aktualisierenden Ressource.
 * @param {Object} req.body - Die neuen Daten für die Ressource.
 * @returns {Object} 200 - Die aktualisierte, angereicherte Ressource.
 * @returns {Object} 400 - Keine Daten zum Aktualisieren vorhanden oder ungültige Daten.
 * @returns {Object} 404 - Ressource nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 */
router.put('/:id', async (req, res, next) => {
  const resourceId = req.params.id;
  const newData = req.body;

  if (!newData || Object.keys(newData).length === 0) {
    res.status(400).json({ error: 'Keine Daten zum Aktualisieren vorhanden.' });
    return;
  }

  try {
    const resources = await readData(RESOURCES_FILE);
    const idx = resources.findIndex(r => String(r.id) === String(resourceId));

    if (idx === -1) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    resources[idx] = { ...resources[idx], ...newData, updatedAt: new Date().toISOString() };
    await writeData(RESOURCES_FILE, resources);

    // Enriched response (read latest ratings & feedback)
    const ratings  = await readData(RATINGS_FILE);
    const feedback = await readData(FEEDBACK_FILE);
    const enriched = buildEnrichedResource(resources[idx], ratings, feedback);

    res.status(200).json(enriched);
  } catch (error) {
    console.error(`Fehler beim Aktualisieren der Ressource mit ID ${req.params.id}:`, error);
    next(error);
  }
});

/**
 * @route DELETE /:id
 * @summary Löscht eine Ressource anhand ihrer ID.
 * @description
 * Entfernt eine Ressource permanent aus dem Katalog.
 *
 * @access Public
 * @param {string} req.params.id - Die ID der zu löschenden Ressource.
 * @returns {Object} 204 - Erfolgreich gelöscht (kein Inhalt).
 * @returns {Object} 404 - Ressource nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 */
router.delete('/:id', async (req, res, next) => {
  const resourceId = req.params.id;

  try {
    let resources = await readData(RESOURCES_FILE);
    const initialLength = resources.length;

    resources = resources.filter(r => String(r.id) !== String(resourceId));

    if (resources.length === initialLength) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    await writeData(RESOURCES_FILE, resources);
    res.status(204).end();
  } catch (error) {
    console.error(`Fehler beim Löschen der Ressource mit ID ${req.params.id}:`, error);
    next(error);
  }
});

// --- RATING ENDPOINTS ---

/**
 * @route POST /:resourceId/ratings
 * @summary Fügt einer Ressource eine neue Bewertung hinzu **und gibt die angereicherte Ressource zurück**.
 * @description
 * Nimmt Bewertungsdaten (`ratingValue`, `userId`) entgegen, generiert eine UUID und speichert die Bewertung.
 * **Antwort:** Die **aktualisierte Ressource** (mit `averageRating` und vollständigem `feedback`-Array).
 *
 * Validierung erfolgt über die `validateRating`-Middleware.
 *
 * @access Public
 * @param {string} req.params.resourceId - Die ID der Ressource, die bewertet wird.
 * @param {Object} req.body - Die Bewertungsdaten ({ ratingValue: number, userId?: string }).
 * @returns {Object} 201 - Die aktualisierte, angereicherte Ressource.
 * @returns {Object} 400 - Ungültige oder fehlende Bewertungsdaten.
 * @returns {Object} 404 - Ressource nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 *
 * @example
 * // Request: POST /resources/123/ratings
 * // Body: { "ratingValue": 5, "userId": "alice" }
 * // Response (201): { id, title, ..., averageRating: 4.7, feedback: [...] }
 */
router.post('/:resourceId/ratings', validateRating, async (req, res, next) => {
  const resourceId = req.params.resourceId;
  const { ratingValue, userId } = req.body;

  const newRating = {
    id: uuidv4(),
    resourceId: String(resourceId),
    ratingValue: Number(ratingValue),
    userId: userId ? String(userId) : 'anonymous',
    timestamp: new Date().toISOString()
  };

  try {
    // Validieren, dass die Ressource existiert
    const resources = await readData(RESOURCES_FILE);
    const resource = resources.find(r => String(r.id) === String(resourceId));
    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    const ratings  = await readData(RATINGS_FILE);
    const feedback = await readData(FEEDBACK_FILE);

    ratings.push(newRating);
    await writeData(RATINGS_FILE, ratings);

    const enriched = buildEnrichedResource(resource, ratings, feedback);
    res.status(201).json(enriched);
  } catch (error) {
    console.error(`Fehler beim Hinzufügen einer Bewertung für Ressource ${req.params.resourceId}:`, error);
    next(error);
  }
});

// --- FEEDBACK ENDPOINTS ---

/**
 * @route POST /:resourceId/feedback
 * @summary Fügt einer Ressource ein neues Feedback hinzu **und gibt die angereicherte Ressource zurück**.
 * @description
 * Nimmt Feedback-Text und optional eine Benutzer-ID entgegen, generiert eine UUID und speichert das Feedback.
 * **Antwort:** Die **aktualisierte Ressource** (mit `averageRating` und vollständigem `feedback`-Array).
 *
 * Validierung erfolgt über die `validateFeedback`-Middleware.
 *
 * @access Public
 * @param {string} req.params.resourceId - Die ID der Ressource, für die Feedback gegeben wird.
 * @param {Object} req.body - Die Feedback-Daten ({ feedbackText: string, userId?: string }).
 * @returns {Object} 201 - Die aktualisierte, angereicherte Ressource.
 * @returns {Object} 400 - Ungültige oder fehlende Feedback-Daten.
 * @returns {Object} 404 - Ressource nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 *
 * @example
 * // Request: POST /resources/123/feedback
 * // Body: { "feedbackText": "Super erklärt!", "userId": "bob" }
 * // Response (201): { id, title, ..., averageRating, feedback: [ ...neu hinzugefügter Eintrag..., ... ] }
 */
router.post('/:resourceId/feedback', validateFeedback, async (req, res, next) => {
  const resourceId = req.params.resourceId;
  const { feedbackText, userId } = req.body;

  const newFeedback = {
    id: uuidv4(),
    resourceId: String(resourceId),
    feedbackText: String(feedbackText).trim(),
    userId: userId ? String(userId) : 'anonymous',
    timestamp: new Date().toISOString()
  };

  try {
    // Validieren, dass die Ressource existiert
    const resources = await readData(RESOURCES_FILE);
    const resource = resources.find(r => String(r.id) === String(resourceId));
    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    const ratings  = await readData(RATINGS_FILE);
    const feedback = await readData(FEEDBACK_FILE);

    feedback.push(newFeedback);
    await writeData(FEEDBACK_FILE, feedback);

    const enriched = buildEnrichedResource(resource, ratings, feedback);
    res.status(201).json(enriched);
  } catch (error) {
    console.error(`Fehler beim Hinzufügen von Feedback für Ressource ${req.params.resourceId}:`, error);
    next(error);
  }
});

/**
 * @route PUT /:resourceId/feedback/:feedbackId
 * @summary Aktualisiert ein bestehendes Feedback für eine Ressource.
 * @description
 * Aktualisiert den `feedbackText` eines Feedback-Eintrags und setzt den `timestamp` neu.
 * **Hinweis:** Diese Route gibt den **aktualisierten Feedback-Eintrag** zurück (nicht die ganze Ressource).
 *
 * @access Public
 * @param {string} req.params.resourceId - Die ID der Ressource, zu der das Feedback gehört.
 * @param {string} req.params.feedbackId - Die ID des zu aktualisierenden Feedbacks.
 * @param {Object} req.body - Die aktualisierten Feedback-Daten ({ feedbackText: string }).
 * @returns {Object} 200 - Das aktualisierte Feedback-Objekt.
 * @returns {Object} 400 - Ungültige oder fehlende Feedback-Daten.
 * @returns {Object} 404 - Feedback nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 */
router.put('/:resourceId/feedback/:feedbackId', validateFeedback, async (req, res, next) => {
  const resourceId = req.params.resourceId;
  const feedbackId = req.params.feedbackId;
  const { feedbackText } = req.body;

  try {
    const feedback = await readData(FEEDBACK_FILE);
    const idx = feedback.findIndex(
      f => String(f.id) === String(feedbackId) && String(f.resourceId) === String(resourceId)
    );

    if (idx === -1) {
      res.status(404).json({ error: `Feedback mit ID ${feedbackId} für Ressource ${resourceId} nicht gefunden.` });
      return;
    }

    feedback[idx] = {
      ...feedback[idx],
      feedbackText: String(feedbackText).trim(),
      timestamp: new Date().toISOString()
    };

    await writeData(FEEDBACK_FILE, feedback);
    res.status(200).json(feedback[idx]);
  } catch (error) {
    console.error(`Fehler beim Aktualisieren von Feedback ${req.params.feedbackId} für Ressource ${req.params.resourceId}:`, error);
    next(error);
  }
});

/**
 * @route DELETE /:resourceId/feedback/:feedbackId
 * @summary Löscht ein Feedback für eine bestimmte Ressource.
 * @description
 * Entfernt einen Feedback-Eintrag anhand seiner ID und der zugehörigen Ressourcen-ID.
 *
 * @access Public
 * @param {string} req.params.resourceId - Die ID der Ressource, zu der das Feedback gehört.
 * @param {string} req.params.feedbackId - Die ID des zu löschenden Feedbacks.
 * @returns {Object} 204 - Erfolgreich gelöscht (kein Inhalt).
 * @returns {Object} 404 - Feedback nicht gefunden.
 * @returns {Object} 500 - Interner Serverfehler.
 */
router.delete('/:resourceId/feedback/:feedbackId', async (req, res, next) => {
  const resourceId = req.params.resourceId;
  const feedbackId = req.params.feedbackId;

  try {
    let feedback = await readData(FEEDBACK_FILE);
    const initialLength = feedback.length;

    feedback = feedback.filter(
      f => !(String(f.id) === String(feedbackId) && String(f.resourceId) === String(resourceId))
    );

    if (feedback.length === initialLength) {
      res.status(404).json({ error: `Feedback mit ID ${feedbackId} für Ressource ${resourceId} nicht gefunden.` });
      return;
    }

    await writeData(FEEDBACK_FILE, feedback);
    res.status(204).end();
  } catch (error) {
    console.error(`Fehler beim Löschen von Feedback ${req.params.feedbackId} für Ressource ${req.params.resourceId}:`, error);
    next(error);
  }
});

export default router;
