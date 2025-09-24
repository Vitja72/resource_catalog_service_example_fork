import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const FeedbackSchema = new Schema(
    {
        resourceId: { type: Types.ObjectId, ref: "Resource", index: true, required: true },
        feedbackText: { type: String, required: true },
        userId: String,
        timestamp: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

export default mongoose.model("Feedback", FeedbackSchema, "feedback");