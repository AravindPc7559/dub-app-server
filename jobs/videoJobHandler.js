const { Video } = require("../models");
const { getFile } = require("../utils/r2");
const { extractAudio } = require("../utils/extractAudio");

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const processVideoJob = async (job) => {
  const { videoId, userId, step, type } = job;

  console.log('Processing video job', { videoId, userId, step, type });
  
  // 1. Download video
  const video = await Video.findById(videoId);
  if (!video) {
    console.log('Video not found');
    return;
  }

  const { s3Key } = video.inputVideo;
  const { durationSec } = video.inputVideo;
  const { format } = video.inputVideo;

  const videoResponse = await getFile(s3Key);
  const videoBuffer = await streamToBuffer(videoResponse.Body);
  
  // 2. Extract audio
  const audioBuffer = await extractAudio(videoBuffer, 'wav');
  console.log('Audio extracted successfully', { size: audioBuffer.length });

  // 3. Demucs
  // 4. Whisper
  // 5. GPT rewrite
  // 6. Upload results
};

module.exports = {
  processVideoJob,
};
  