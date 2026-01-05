const { processJob } = require('../jobs/jobProcessor');
const { Job, Video } = require('../models');
const mongoose = require('mongoose');
const { LOCK_TIMEOUT, POLL_INTERVAL, JOB_STATUS, VIDEO_STATUS } = require('../const/worker.constants');
const { sleep, updateVideoStatus, handleJobFailure, handleJobSuccess } = require('../utils/worker.utils');

// Check if MongoDB connection is ready
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1; // 1 = connected
};

const startWorker = async () => {
  console.log('Worker started');

  while (true) {
    let job = null;
    
    try {
      // Check MongoDB connection before processing
      if (!isMongoConnected()) {
        console.warn('MongoDB not connected. Waiting for connection...');
        await sleep(5000); // Wait 5 seconds before retrying
        continue;
      }

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
      // Check if it's a MongoDB connection error
      const isMongoError = err.name === 'MongoNetworkError' || 
                          err.name === 'MongoNetworkTimeoutError' ||
                          err.name === 'MongoServerSelectionError' ||
                          err.name === 'PoolClearedOnNetworkError' ||
                          (err.message && (
                            err.message.includes('connection') ||
                            err.message.includes('timeout') ||
                            err.message.includes('network')
                          ));

      if (isMongoError) {
        console.error('MongoDB connection error detected:', err.message);
        console.log('Waiting for MongoDB connection to recover...');
        
        // Wait longer for MongoDB to recover
        await sleep(5000);
        
        // Try to reconnect if connection is lost
        if (!isMongoConnected()) {
          try {
            await mongoose.connection.close();
            // Reconnect will be handled by the connection event handlers
            console.log('Attempting to reconnect to MongoDB...');
          } catch (reconnectError) {
            console.error('Error during reconnection attempt:', reconnectError.message);
          }
          await sleep(5000);
        }
        continue; // Skip to next iteration without processing job
      }

      console.error('Job processing error:', err);
      
      if (job) {
        try {
          await handleJobFailure(job, err);
        } catch (failureError) {
          console.error('Error handling job failure:', failureError);
          // Continue processing even if failure handling fails
        }
      }
    }
    
    // Small delay to prevent tight loop on errors
    await sleep(1000);
  }
};

module.exports = {
  startWorker,
};
