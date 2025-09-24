import mongoose from "mongoose";

const { Types } = mongoose;

export function toObjectId(id) {
    if (!Types.ObjectId.isValid(id)) {
        const err = new Error("Ungueltige ObjectId");
        err.status = 400;
        throw err;
    }
    if (typeof id !== "string") {
        const err = new Error("ObjectId muss ein String sein");
        err.status = 400;
        throw err;
    }
    return new Types.ObjectId(id);
}

export function toClient(doc) {
    if (!doc) return doc;
    const {_id, __v, ...rest} = doc;
    return {id: String(_id), ...rest};
}