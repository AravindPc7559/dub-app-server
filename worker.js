// Load environment variables first, before any other modules
require('dotenv').config();

const connectDB = require('./config/database');
const { startWorker } = require('./services/worker.service');

(async () => {
    try {
        await connectDB();
        console.log('MongoDB connected in worker');
        await startWorker();
        console.log('Worker started');
    } catch (error) {
        console.error('Worker error:', error);
        process.exit(1);
    }
})()