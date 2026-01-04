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
const { JOB_STATUS, VIDEO_STATUS } = require("../const/worker.constants");

const processVideoJob = async (job) => {
  const { videoId, userId } = job;
  const { audioFilePath, demucsOutputDir } = getVideoPaths(videoId);
  const startTime = Date.now();

  const video = await Video.findById(videoId);
  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  try {
    video.status = variables.PROCESSING;
    await video.save();

    console.log(`[Job] Processing video ${videoId}`);

    // Phase 1: Download video (start early, will be used later)
    const downloadStart = Date.now();
    const { s3Key } = video.inputVideo;
    const videoDownloadPromise = downloadVideo(s3Key);
    
    // Phase 2: Extract audio (wait for download)
    const extractStart = Date.now();
    const videoBuffer = await videoDownloadPromise;
    const downloadTime = ((Date.now() - downloadStart) / 1000).toFixed(2);
    console.log(`[Job] Video downloaded (${downloadTime}s)`);
    
    const audioBuffer = await extractAudio(videoBuffer, 'wav');
    saveAudioToFile(audioBuffer, audioFilePath);
    const extractTime = ((Date.now() - extractStart) / 1000).toFixed(2);
    console.log(`[Job] Audio extracted (${extractTime}s)`);

    // Phase 3: Separate audio
    const separateStart = Date.now();
    const { vocalsBuffer, backgroundBuffer } = await processAudioSeparation(
      audioFilePath,
      demucsOutputDir
    );
    const separateTime = ((Date.now() - separateStart) / 1000).toFixed(2);
    console.log(`[Job] Audio separated (${separateTime}s)`);

    // Phase 4: Upload audio files
    const uploadStart = Date.now();
    const uploadResults = await uploadAudioFiles(
      audioBuffer,
      vocalsBuffer,
      backgroundBuffer,
      userId,
      videoId
    );
    const uploadTime = ((Date.now() - uploadStart) / 1000).toFixed(2);
    console.log(`[Job] Audio files uploaded (${uploadTime}s)`);

    // Phase 5: Transcribe
    const transcribeStart = Date.now();
    const transcription = await transcribeVocalsAudio(
      vocalsBuffer,
      videoId,
      video.videoLanguage || null
    );
    const transcribeTime = ((Date.now() - transcribeStart) / 1000).toFixed(2);
    console.log(`[Job] Transcription completed (${transcribeTime}s)`);

    await updateVideoWithTranscription(video, transcription);

    if (transcription?.segments) {
      const voice = video.selectedVoice || null;
      const targetLanguage = video.targetLanguage || 'en';
      
      // Phase 6: Translate/rewrite script
      const translateStart = Date.now();
      const rewrittenScript = await translateSegments({
        segments: transcription?.segments,
        videoLanguage: LANGUAGE_MAP[video?.videoLanguage],
        targetLanguage: LANGUAGE_MAP[video?.targetLanguage],
        voice: voice,
        targetLanguageCode: targetLanguage
      });
      const translateTime = ((Date.now() - translateStart) / 1000).toFixed(2);
      console.log(`[Job] Script rewritten (${rewrittenScript.length} segments, ${translateTime}s)`);

      video.subTitles = rewrittenScript;
      await video.save();

      const scriptUploadResult = await uploadRewrittenScript(rewrittenScript, userId, videoId);
      await updateVideoWithRewrittenScript(video, scriptUploadResult);

      // Phase 7: Generate TTS
      const ttsStart = Date.now();
      const ttsResults = await generateTTSForSegments(rewrittenScript, videoId, voice, targetLanguage);
      const ttsTime = ((Date.now() - ttsStart) / 1000).toFixed(2);
      console.log(`[Job] TTS generated (${ttsTime}s)`);

      // Phase 8: Assemble audio
      const assembleStart = Date.now();
      const finalAudio = await buildFinalAudio(userId, videoId, ttsResults);
      const assembleTime = ((Date.now() - assembleStart) / 1000).toFixed(2);
      console.log(`[Job] Audio assembled (${assembleTime}s)`);

      await updateVideoWithAudioKeys(video, { ...uploadResults, tts: finalAudio });

      // Phase 9: Finalize video
      const finalizeStart = Date.now();
      const output = await finalizeVideo(userId, video._id, video.inputVideo.s3Key);
      const finalizeTime = ((Date.now() - finalizeStart) / 1000).toFixed(2);
      console.log(`[Job] Video finalized (${finalizeTime}s)`);

      await updateVideoWithTTSAudio(video, output);
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[Job] Completed successfully (Total: ${totalTime}s)`);
    }

  } catch (err) {
    const errorMessage = err.message || 'Unknown error occurred';
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Update both job and video status to FAILED
    await Promise.all([
      Job.findOneAndUpdate(
        { videoId: video._id },
        { 
          status: JOB_STATUS.FAILED,
          error: errorMessage
        }
      ),
      Video.findByIdAndUpdate(
        video._id,
        {
          status: VIDEO_STATUS.FAILED,
          error: errorMessage
        }
      )
    ]);
    
    console.error(`[Job] Failed after ${totalTime}s:`, errorMessage);
    throw err;
  }
};

module.exports = {
  processVideoJob,
};
