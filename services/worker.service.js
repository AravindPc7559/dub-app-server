const { processJob } = require('../jobs/jobProcessor');
const { Job, Video } = require('../models');
const { LOCK_TIMEOUT, POLL_INTERVAL, JOB_STATUS, VIDEO_STATUS } = require('../const/worker.constants');
const { sleep, updateVideoStatus, handleJobFailure, handleJobSuccess } = require('../utils/worker.utils');

const startWorker = async () => {
  console.log('Worker started');

  while (true) {
    let job = null;
    
    try {
      // Atomically lock and fetch a pending job
      job = await Job.findOneAndUpdate(
        {
          status: JOB_STATUS.PENDING,
          $or: [
            { lockedAt: null },
            { lockedAt: { $lt: new Date(Date.now() - LOCK_TIMEOUT) } }
          ]
        },
        {
          $set: {
            status: JOB_STATUS.RUNNING,
            lockedAt: new Date(),
          },
          $inc: { attempts: 1 }
        },
        { new: true, sort: { createdAt: 1 } } // Process oldest jobs first
      );

      if (!job) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Verify video exists before processing
      const video = await Video.findById(job.videoId);
      if (!video) {
        console.error(`Video not found for job ${job._id}, videoId: ${job.videoId}`);
        job.status = JOB_STATUS.FAILED;
        job.error = 'Video not found';
        job.lockedAt = null;
        await job.save();
        continue;
      }

      // Update video status to PROCESSING
      await updateVideoStatus(job.videoId, VIDEO_STATUS.PROCESSING);

      // Process the job
      await processJob(job);
      
      // Job completed successfully
      await handleJobSuccess(job);
      
    } catch (err) {
      console.error('Job processing error:', err);
      
      if (job) {
        await handleJobFailure(job, err);
      }
    }
  }
};

module.exports = {
  startWorker,
};
