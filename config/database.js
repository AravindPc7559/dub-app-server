const mongoose = require('mongoose');

const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dub-app';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoURI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
