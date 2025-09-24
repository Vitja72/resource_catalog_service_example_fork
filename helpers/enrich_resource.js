/**
 * @file Helfer zum Anreichern eines Ressourcenobjekts mit Bewertungen & Feedback.
 */


import Rating from '../models/rating.js';
import Feedback from '../models/feedback.js';
import { toClient } from '../utils/mongo.js';

export async function buildEnrichedResource(resource) {
  const _id = resource._id;

  const [avgDoc] = await Rating.aggregate([
    { $match: { resourceId: _id } },
    { $group: { _id: _id, avg: { $avg: "$ratingValue" } } }
  ]);

  const avgRating = avgDoc?.avg ?? 0;

  const feedback = await Feedback.find({ resourceId: _id }).lean();

  return {
    ...toClient(resource),
    averageRating: avgRating,
    feedback: feedback.map(toClient)
  };
}
