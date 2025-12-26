const { Job } = require("../models");

const createJob = async (type, videoId, userId, step, status = null, retries = 0) => {
  return await Job.create({
    type,
    videoId,
    userId,
    step,
    status: status || 'PENDING',
    retries,
  });
};

module.exports = {
  createJob,
};