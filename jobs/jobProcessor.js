const variables = require('../const/variables');
const { processVideoJob } = require('./videoJobHandler');

const processJob = async (job) => {
  switch (job.type) {
    case variables.VIDEO_PROCESS:
      return processVideoJob(job);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
};

module.exports = {
  processJob,
};
