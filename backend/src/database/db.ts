import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

export const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error("MONGODB_URI is not defined in environment variables");
        }

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10_000,
            socketTimeoutMS: 45_000,
            maxPoolSize: 20,
            minPoolSize: 2,
            heartbeatFrequencyMS: 10_000,
            retryWrites: true,
            retryReads: true,
        });

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected. Mongoose will attempt to reconnect.');
        });

        mongoose.connection.on('reconnected', () => {
            console.log('MongoDB reconnected.');
        });

        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        throw error;
    }
};

export default connectDB;
