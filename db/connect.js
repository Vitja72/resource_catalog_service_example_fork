import mongoose from "mongoose";

export async function connectDB (
    uri,
    { dbName = process.env.MONGO_DB || "resource_catalog" } = {}
) {
    mongoose.set("strictQuery", true);

    const retries = 10;
    const delayMs = 2000;

    for (let i = 1; i <= retries; i++) {
        try {
            await mongoose.connect(uri, { dbName });
            console.log(`[MongoDB] connected to ${dbName}`);
            return;
        } catch (err) {
            console.error(`[MongoDB] connect attempt ${i}/${retries} failed: ${err.message}`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    process.exit(1);
};