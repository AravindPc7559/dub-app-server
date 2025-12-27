const { Video } = require('../models');
const { JOB_STATUS, VIDEO_STATUS } = require('../const/worker.constants');

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Update video status in the database
 * @param {string} videoId - Video document ID
 * @param {string} status - New status to set
 * @param {string|null} error - Optional error message
 * @returns {Promise<void>}
 */
const updateVideoStatus = async (videoId, status, error = null) => {
  try {
    const update = { status };
    if (error) {
      update.error = error;
    }
    await Video.findByIdAndUpdate(videoId, { $set: update });
  } catch (err) {
    console.error(`Failed to update video ${videoId} status:`, err.message);
  }
};

/**
 * Handle job failure - update job status and video status if max attempts reached
 * @param {Object} job - Job document
 * @param {Error} error - Error that occurred
 * @returns {Promise<void>}
 */
const handleJobFailure = async (job, error) => {
  const isMaxAttemptsReached = job.attempts >= job.maxAttempts;
  
  job.status = isMaxAttemptsReached ? JOB_STATUS.FAILED : JOB_STATUS.PENDING;
  job.error = error.message;
  job.lockedAt = null;
  
  await job.save();
  
  // Only update video to FAILED if job is permanently failed (max attempts reached)
  if (isMaxAttemptsReached) {
    await updateVideoStatus(job.videoId, VIDEO_STATUS.FAILED, error.message);
  }
};

/**
 * Handle job success - update job status to DONE and video status to COMPLETED
 * @param {Object} job - Job document
 * @returns {Promise<void>}
 */
const handleJobSuccess = async (job) => {
  job.status = JOB_STATUS.DONE;
  job.error = null;
  job.lockedAt = null;
  
  await job.save();
  
  // Update video status to COMPLETED only when job is fully done
  await updateVideoStatus(job.videoId, VIDEO_STATUS.COMPLETED);
};

module.exports = {
  sleep,
  updateVideoStatus,
  handleJobFailure,
  handleJobSuccess,
};

