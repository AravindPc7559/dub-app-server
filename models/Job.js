const mongoose = require('mongoose');
const { jobStatus, jobStep } = require('../const/options');
const variables = require('../const/variables');

const jobSchema = new mongoose.Schema({
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: jobStatus,
    default: variables.PENDING,
    index: true,
  },
  step: {
    type: String,
    enum: jobStep,
  },
  retries: {
    type: Number,
    default: 0,
  },
  type: {
    type: String,
    required: true,
  },
  error: {
    type: String,
    default: null,
  },
  lockedAt: {
    type: Date,
    default: null,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 3,
  },
}, {
  timestamps: true,
});

jobSchema.index({ videoId: 1, createdAt: -1 });
jobSchema.index({ userId: 1, status: 1 });
jobSchema.index({ status: 1, step: 1 });
jobSchema.index({ status: 1, lockedAt: 1 });

module.exports = mongoose.model('Job', jobSchema);

