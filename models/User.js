const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  socialMediaAccountName: {
    type: String,
    trim: true,
  },
  authProvider: {
    type: String,
    default: 'local',
    enum: ['local', 'google', 'facebook'],
  },
  plan: {
    type: String,
    default: 'CREATOR',
    enum: ['CREATOR', 'PRO', 'ENTERPRISE'],
  },
  monthlyLimit: {
    type: Number,
    default: 15,
  },
  reelsUsedThisMonth: {
    type: Number,
    default: 3,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);

