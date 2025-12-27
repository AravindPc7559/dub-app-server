// Load environment variables first, before any other modules
require('dotenv').config();

const connectDB = require('./config/database');
const { startWorker } = require('./services/worker.service');

connectDB();
startWorker();