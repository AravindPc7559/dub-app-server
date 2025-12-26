const connectDB = require('./config/database');
const { startWorker } = require('./services/worker.service');

connectDB();
startWorker();