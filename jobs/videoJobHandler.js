const { Video } = require("../models");
const { extractAudio } = require("../utils/extractAudio");
const {
  getVideoPaths,
  saveAudioToFile,
  cleanupTempFiles,
  downloadVideo,
  processAudioSeparation,
  uploadAudioFiles,
  transcribeVocalsAudio,
  updateVideoWithAudioKeys,
  updateVideoWithTranscription,
  uploadRewrittenScript,
  updateVideoWithRewrittenScript,
} = require("../utils/videoJob.utils");
const variables = require("../const/variables");
const { translateSegments } = require("../services/gptTranslate.service");
const { LANGUAGE_MAP } = require("../const/openAiLanguages");

/**
 * Process video job - main handler
 * @param {Object} job - Job object with videoId, userId, etc.
 */
const processVideoJob = async (job) => {
  const { videoId, userId } = job;
  
  // Get all file paths
  const { audioFilePath, demucsOutputDir, baseName } = getVideoPaths(videoId);
  
  try {
    // 1. Load and validate video
    const video = await Video.findById(videoId);
    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    // Update video status to processing
    video.status = variables.PROCESSING;
    await video.save();

    // 2. Download video from R2
    const { s3Key } = video.inputVideo;
    const videoBuffer = await downloadVideo(s3Key);
    console.log('Video downloaded from R2');
    
    // 3. Extract audio from video
    const audioBuffer = await extractAudio(videoBuffer, 'wav');
    console.log('Audio extracted from video');

    // 4. Save audio to temporary file
    saveAudioToFile(audioBuffer, audioFilePath);

    // 5. Separate vocals and background using Demucs
    const { vocalsBuffer, backgroundBuffer } = await processAudioSeparation(
      audioFilePath,
      demucsOutputDir
    );

    // 6. Upload all audio files to R2
    const uploadResults = await uploadAudioFiles(
      audioBuffer,
      vocalsBuffer,
      backgroundBuffer,
      userId,
      videoId
    );
    console.log('All audio files uploaded to R2');

    // 7. Update database with audio keys
    await updateVideoWithAudioKeys(video, uploadResults);

    // 8. Transcribe vocals audio using Whisper
    const transcription = await transcribeVocalsAudio(
      vocalsBuffer,
      videoId,
      video.videoLanguage || null
    );
    console.log('Audio transcription completed', transcription);

    // 9. Update database with transcription
    await updateVideoWithTranscription(video, transcription);

    if(transcription?.segments){
      // 10. Translate and rewrite script
      const rewrittenScript = await translateSegments({
        segments: transcription?.segments,
        videoLanguage: LANGUAGE_MAP[video?.videoLanguage],
        targetLanguage: LANGUAGE_MAP[video?.targetLanguage],
      });
      console.log('Rewritten script completed', rewrittenScript);

      // 11. Upload rewritten script to R2
      const scriptUploadResult = await uploadRewrittenScript(
        rewrittenScript,
        userId,
        videoId
      );

      // 12. Update database with rewritten script key
      await updateVideoWithRewrittenScript(video, scriptUploadResult);
    }
    
  } catch (err) {
    console.error('Error processing video job:', err);
    throw err;
  } finally {
    // 10. Always clean up temporary files, even if there was an error
    cleanupTempFiles(audioFilePath, demucsOutputDir, baseName);
  }
};

module.exports = {
  processVideoJob,
};
  