import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Resource from "../models/resource.js";
import Rating from "../models/rating.js";
import Feedback from "../models/feedback.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");
const readJson = (f) => fs.readFile(path.join(dataDir, f), "utf-8").then(JSON.parse);

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGO_DB || "resource_catalog";

await mongoose.connect(uri, { dbName });
console.log(`[seed] Connected → ${dbName}`);

// 1) Ressourcen importieren (Mongo vergibt frische ObjectIds)
const rawResources = await readJson("resources.json");
const createdResources = await Resource.insertMany(
  rawResources.map((r) => ({
    title: r.title,
    type: r.type,
    description: r.description,
    authorId: r.authorId,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : null
  })),
  { ordered: false }
);

// Map: alteId(String) -> newId(ObjectId) (falls resources.json ein id-Feld hatte)
const oldToNewId = new Map();
for (let i = 0; i < rawResources.length; i++) {
  const old = rawResources[i];
  const created = createdResources[i];
  if (old?.id && created?._id) {
    oldToNewId.set(String(old.id), created._id);
  }
}

// 2) Ratings importieren (resourceId-Strings auf ObjectIds mappen)
const rawRatings = await readJson("ratings.json");
const ratingsDocs = rawRatings
  .map((r) => {
    const rid = oldToNewId.get(String(r.resourceId));
    if (!rid) return null; // Resource fehlt: überspringen
    return {
      resourceId: rid,
      ratingValue: Number(r.ratingValue),
      userId: r.userId || null,
      timestamp: r.timestamp ? new Date(r.timestamp) : new Date()
    };
  })
  .filter(Boolean);

if (ratingsDocs.length) await Rating.insertMany(ratingsDocs, { ordered: false });

// 3) Feedback importieren (ebenfalls mappen)
const rawFeedback = await readJson("feedback.json");
const feedbackDocs = rawFeedback
  .map((f) => {
    const rid = oldToNewId.get(String(f.resourceId));
    if (!rid) return null;
    return {
      resourceId: rid,
      feedbackText: f.feedbackText,
      userId: f.userId || null,
      timestamp: f.timestamp ? new Date(f.timestamp) : new Date()
    };
  })
  .filter(Boolean);

if (feedbackDocs.length) await Feedback.insertMany(feedbackDocs, { ordered: false });

await mongoose.disconnect();
console.log("[seed] Done.");