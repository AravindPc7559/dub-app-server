const options = require('./options');

// Worker configuration constants
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL = 3000; // 3 seconds

// Job status enum
const JOB_STATUS = {
  PENDING: options.jobStatus[0],
  RUNNING: options.jobStatus[1],
  DONE: options.jobStatus[2],
  FAILED: options.jobStatus[3],
};

// Video status enum
const VIDEO_STATUS = {
  PENDING: options.videoStatus[0],
  PROCESSING: options.videoStatus[1],
  COMPLETED: options.videoStatus[2],
  FAILED: options.videoStatus[3],
};

module.exports = {
  LOCK_TIMEOUT,
  POLL_INTERVAL,
  JOB_STATUS,
  VIDEO_STATUS,
};

