const { Video, Job } = require("../models");
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
  generateTTSForSegments,
  uploadTTSAudio,
  updateVideoWithTTSAudio,
} = require("../utils/videoJob.utils");
const variables = require("../const/variables");
const { translateSegments } = require("../services/gptTranslate.service");
const { LANGUAGE_MAP } = require("../const/openAiLanguages");
const { buildFinalAudio } = require("../utils/audioAssembler");
const { finalizeVideo } = require("../services/videoFinalizer.service");
const { jobStatus, videoStatus } = require("../const/options");

/**
 * Process video job - main handler
 * @param {Object} job - Job object with videoId, userId, etc.
 */
const processVideoJob = async (job) => {
  const { videoId, userId } = job;

  const { audioFilePath, demucsOutputDir } = getVideoPaths(videoId);
  // 1. Load and validate video
  const video = await Video.findById(videoId);
  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  try {

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


    // 8. Transcribe vocals audio using Whisper
    const transcription = await transcribeVocalsAudio(
      vocalsBuffer,
      videoId,
      video.videoLanguage || null
    );
    console.log('Audio transcription completed');

    // 9. Update database with transcription
    await updateVideoWithTranscription(video, transcription);

    if (transcription?.segments) {
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

      // 13. Generate TTS audio for rewritten script segments and save locally
      const voice = video.selectedVoice || 'alloy';
      const ttsResults = await generateTTSForSegments(rewrittenScript, videoId, voice);
      console.log('TTS audio generated and saved locally for all segments', ttsResults);

      const finalAudio = await buildFinalAudio(userId, videoId, ttsResults);
      console.log('Final audio built and uploaded to R2');

       // 7. Update database with audio keys
    await updateVideoWithAudioKeys(video, {...uploadResults, tts: finalAudio});
      
      const output = await finalizeVideo(userId, video._id, video.inputVideo.s3Key);
      console.log('Video finalized and uploaded to R2');

      // 14. Update database with final audio key
      await updateVideoWithTTSAudio(video, output);
    }

  } catch (err) {
    await Job.findOneAndUpdate(
      { videoId: video._id }, 
      { status: jobStatus[3] }
    );
    throw err;
  } finally {
    // 10. Always clean up temporary files, even if there was an error
    cleanupTempFiles(videoId.toString());
  }
};

module.exports = {
  processVideoJob,
};
