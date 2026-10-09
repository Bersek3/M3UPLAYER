// api/_lib/db.js — Shared MongoDB connection for Vercel Serverless Functions
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/m3u_tv_database?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'm3u_tv_database';

let cachedClient = null;
let cachedDb = null;

async function connectDB() {
    if (cachedDb) return cachedDb;

    const client = new MongoClient(MONGO_URI, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 10000,
    });

    await client.connect();
    const db = client.db(DB_NAME);
    cachedClient = client;
    cachedDb = db;
    return db;
}

module.exports = { connectDB };
