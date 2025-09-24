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
    const _id = toObjectId(req.params.id);

    const resource = await Resource.findById(_id).lean();

    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${req.params.id} nicht gefunden.` });
      return;
    }

    const enriched_resource = await buildEnrichedResource(resource);
    res.status(200).json(enriched_resource);

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
  try {
    const newResource = {
      ...req.body,
      createdAt: new Date()
    };
    const created_resource = await Resource.create(newResource);
    res.status(201).json(toClient(created_resource.toObject()));
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
  try {
    const resourceId = req.params.id;
    const _id = toObjectId(resourceId);
    const newData = req.body;

    if (!newData || Object.keys(newData).length === 0) {
      res.status(400).json({ error: 'Keine Daten zum Aktualisieren vorhanden.' });
      return;
    }

    const updated_resource = await Resource.findByIdAndUpdate(
      _id,
      {...newData, updatedAt: new Date()},
      { new: true, lean: true }
    );
    
    if (!updated_resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    const enriched_resource = await buildEnrichedResource(updated_resource);
    res.status(200).json(enriched_resource);

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
  try {
    const resourceId = req.params.id;
    const _id = toObjectId(resourceId);

    const deleted_resource = await Resource.findByIdAndDelete(_id);

    if (!deleted_resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }
    
    await Promise.all([
      Rating.deleteMany({ resourceId: _id }),
      Feedback.deleteMany({ resourceId: _id })
    ]);

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
  try {

    const resourceId = req.params.resourceId;
    const _id = toObjectId(resourceId);

    const resource = await Resource.findById(_id).lean();

    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    const { ratingValue, userId } = req.body;

    const newRating = {
      resourceId: _id,
      ratingValue: Number(ratingValue),
      userId: userId ? String(userId) : 'anonymous',
      timestamp: new Date()
    };

    await Rating.create(newRating);

    const enriched = await buildEnrichedResource(resource);
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
  try {
    const resourceId = req.params.resourceId;
    const _id = toObjectId(resourceId);
    const { feedbackText, userId } = req.body;

    const resource = await Resource.findById(_id).lean();

    if (!resource) {
      res.status(404).json({ error: `Ressource mit ID ${resourceId} nicht gefunden.` });
      return;
    }

    const newFeedback = {
      resourceId: _id,
      feedbackText: String(feedbackText).trim(),
      userId: userId ? String(userId) : 'anonymous',
      timestamp: new Date()
    };

    await Feedback.create(newFeedback);

    const enriched = await buildEnrichedResource(resource);
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
  try {
    const resourceId = toObjectId(req.params.resourceId);
    const feedbackId = toObjectId(req.params.feedbackId);
    const { feedbackText } = req.body;

    const updated_feedback = await Feedback.findOneAndUpdate(
      { _id: feedbackId, resourceId },
      { feedbackText, timestamp: new Date() },
      { new: true, lean: true }
    );

    if (!updated_feedback){
      res.status(404).json({ error: `Feedback mit ID ${feedbackId} nicht gefunden.` });
      return;
    }

    res.status(200).json(updated_feedback);
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
  try {
    const resourceId = toObjectId(req.params.resourceId);
    const feedbackId = toObjectId(req.params.feedbackId);

    const deleted_feedback = await Feedback.deleteOne(
      { _id: feedbackId, resourceId }
    );

    if (!deleted_feedback){
      res.status(404).json({ error: `Feedback mit ID ${feedbackId} nicht gefunden.` });
      return;
    }

    res.status(204).end();
  } catch (error) {
    console.error(`Fehler beim Löschen von Feedback ${req.params.feedbackId} für Ressource ${req.params.resourceId}:`, error);
    next(error);
  }
});

export default router;
