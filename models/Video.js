const mongoose = require('mongoose');
const { videoStatus } = require('../const/options');
const variables = require('../const/variables');

const videoSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  inputVideo: {
    s3Key: {
      type: String,
      required: true,
    },
    durationSec: {
      type: Number,
      required: true,
    },
    format: {
      type: String,
      required: true,
    },
  },
  targetLanguage: {
    type: String,
    required: true,
    default: 'en',
  },
  videoLanguage: {
    type: String,
    default: 'en',
    required: true,
  },
  selectedVoice: {
    type: String,
    default: 'auto',
  },
  status: {
    type: String,
    enum: videoStatus,
    default: variables.PENDING,
    index: true,
  },
  error: {
    type: String,
    default: null,
  },
  audio: {
    original: {
      type: String,
      default: null,
    },
    voice: {
      type: String,
      default: null,
    },
    background: {
      type: String,
      default: null,
    },
  },
  ai: {
    sourceLanguage: {
      type: String,
      default: null,
    },
    whisperOutput: {
      type: String,
      default: null,
    },
    rewrittenScript: {
      type: String,
      default: null,
    },
  },
  outputVideo: {
    s3Key: {
      type: String,
      default: null,
    },
    downloadUrl: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
}, {
  timestamps: true,
});

videoSchema.index({ userId: 1, createdAt: -1 });
videoSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Video', videoSchema);

