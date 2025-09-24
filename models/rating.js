import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const RatingSchema = new Schema(
    {
        resourceId: { type: Types.ObjectId, ref: "Resource", index: true, required: true },
        ratingValue: { type: Number, min: 1, max: 5, required: true },
        userId: String,
        timestamp: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

export default mongoose.model("Rating", RatingSchema, "ratings");