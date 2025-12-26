import { processJob } from '../jobs/jobProcessor.js';
import Job from '../models/Job.js';

const LOCK_TIMEOUT = 5 * 60 * 1000;

export const startWorker = async () => {
  console.log('Worker started');

  while (true) {
    const job = await Job.findOneAndUpdate(
      {
        status: 'PENDING',
        $or: [
          { lockedAt: null },
          { lockedAt: { $lt: new Date(Date.now() - LOCK_TIMEOUT) } }
        ]
      },
      {
        status: 'PROCESSING',
        lockedAt: new Date(),
        $inc: { attempts: 1 }
      },
      { new: true }
    );

    if (!job) {
      console.log('No job found, sleeping for 3 seconds');
      await sleep(3000);
      continue;
    }

    try {
      await processJob(job);
      job.status = 'COMPLETED';
      job.error = null;
    } catch (err) {
      job.error = err.message;
      job.status =
        job.attempts >= job.maxAttempts ? 'FAILED' : 'PENDING';
      job.lockedAt = null;
    }

    await job.save();
  }
};

const sleep = ms => new Promise(res => setTimeout(res, ms));
