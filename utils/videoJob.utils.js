const fs = require('fs');
const path = require('path');
const { getFile, uploadFileFromBuffer } = require('./r2');
const { runDemucs } = require('../services/demucs.service');
const { transcribeAudio } = require('../services/whisper.service');
const { normalizeSegments } = require('./openAiUtils');
const variables = require('../const/variables');

/**
 * Convert a stream to a buffer
 * @param {Stream} stream - Stream to convert
 * @returns {Promise<Buffer>}
 */
const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Recursively remove directory and its contents
 * @param {string} dirPath - Directory path to remove
 */
const removeDirectory = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        removeDirectory(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath);
  }
};

/**
 * Get temporary file paths for video processing
 * @param {string} videoId - Video ID
 * @returns {Object} Paths object with tmpDir, audioFilePath, demucsOutputDir, baseName
 */
const getVideoPaths = (videoId) => {
  const tmpDir = path.join(__dirname, '../tmp');
  const audioFileName = `${videoId}_audio.wav`;
  const audioFilePath = path.join(tmpDir, audioFileName);
  const demucsOutputDir = path.join(tmpDir, 'htdemucs');
  const baseName = path.basename(audioFilePath, path.extname(audioFilePath));

  return {
    tmpDir,
    audioFilePath,
    demucsOutputDir,
    baseName,
  };
};

/**
 * Save audio buffer to temporary file
 * @param {Buffer} audioBuffer - Audio buffer to save
 * @param {string} audioFilePath - Path where to save the file
 */
const saveAudioToFile = (audioBuffer, audioFilePath) => {
  const tmpDir = path.dirname(audioFilePath);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(audioFilePath, audioBuffer);
  console.log(`Audio saved to tmp folder: ${audioFilePath}`);
};

/**
 * Read separated audio files from demucs output
 * @param {string} vocalsPath - Path to vocals file
 * @param {string} backgroundPath - Path to background file
 * @returns {Object} Object with vocalsBuffer and backgroundBuffer
 */
const readSeparatedAudioFiles = (vocalsPath, backgroundPath) => {
  const vocalsBuffer = fs.readFileSync(vocalsPath);
  const backgroundBuffer = fs.readFileSync(backgroundPath);
  return { vocalsBuffer, backgroundBuffer };
};

/**
 * Clean up all temporary files for a video
 * @param {string} audioFilePath - Path to original audio file
 * @param {string} demucsOutputDir - Demucs output directory
 * @param {string} baseName - Base name of the audio file (without extension)
 */
const cleanupTempFiles = (audioFilePath, demucsOutputDir, baseName) => {
  try {
    // Remove original audio file
    if (fs.existsSync(audioFilePath)) {
      fs.unlinkSync(audioFilePath);
      console.log(`Removed original audio: ${audioFilePath}`);
    }

    // Remove demucs output directory for this specific video
    const demucsVideoDir = path.join(demucsOutputDir, 'htdemucs', baseName);
    if (fs.existsSync(demucsVideoDir)) {
      removeDirectory(demucsVideoDir);
      console.log(`Removed demucs output directory: ${demucsVideoDir}`);
    }
  } catch (err) {
    console.warn('Failed to clean up temporary files:', err.message);
  }
};

/**
 * Download video from R2 and convert to buffer
 * @param {string} s3Key - S3 key of the video
 * @returns {Promise<Buffer>} Video buffer
 */
const downloadVideo = async (s3Key) => {
  const videoResponse = await getFile(s3Key);
  return await streamToBuffer(videoResponse.Body);
};

/**
 * Process audio separation using Demucs
 * @param {string} audioFilePath - Path to input audio file
 * @param {string} demucsOutputDir - Output directory for Demucs
 * @returns {Promise<{vocalsBuffer: Buffer, backgroundBuffer: Buffer}>}
 */
const processAudioSeparation = async (audioFilePath, demucsOutputDir) => {
  const { vocalsPath, backgroundPath } = await runDemucs(audioFilePath, demucsOutputDir);
  console.log('Demucs separation completed:', { vocalsPath, backgroundPath });
  return readSeparatedAudioFiles(vocalsPath, backgroundPath);
};

/**
 * Upload all audio files to R2
 * @param {Buffer} originalBuffer - Original audio buffer
 * @param {Buffer} vocalsBuffer - Vocals audio buffer
 * @param {Buffer} backgroundBuffer - Background audio buffer
 * @param {string} userId - User ID
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} Upload results with keys
 */
const uploadAudioFiles = async (originalBuffer, vocalsBuffer, backgroundBuffer, userId, videoId) => {
  const audioDir = `extracted-audio/${userId}/${videoId}`;
  
  const [originalAudio, vocalsAudio, backgroundAudio] = await Promise.all([
    uploadFileFromBuffer(originalBuffer, 'audio/wav', audioDir, 'original'),
    uploadFileFromBuffer(vocalsBuffer, 'audio/mpeg', audioDir, 'vocals'),
    uploadFileFromBuffer(backgroundBuffer, 'audio/mpeg', audioDir, 'background')
  ]);

  return { originalAudio, vocalsAudio, backgroundAudio };
};

/**
 * Transcribe vocals audio using Whisper
 * @param {Buffer} vocalsBuffer - Vocals audio buffer
 * @param {string} videoId - Video ID for temp file naming
 * @param {string|null} language - Optional language code from video.videoLanguage
 * @returns {Promise<Object>} Transcription result
 */
const transcribeVocalsAudio = async (vocalsBuffer, videoId, language = null) => {
  const tmpDir = path.join(__dirname, '../tmp');
  const vocalsTempPath = path.join(tmpDir, `${videoId}_vocals_temp.mp3`);
  
  try {
    // Save vocals buffer to temporary file
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(vocalsTempPath, vocalsBuffer);
    console.log(`Vocals saved to temp file for transcription: ${vocalsTempPath}`);
    
    // Transcribe using Whisper (uses language if provided and supported, otherwise auto-detects)
    const transcription = await transcribeAudio(vocalsTempPath, language);
    console.log('Audio transcription completed');
    
    // Normalize segments if they exist
    if (transcription.segments && Array.isArray(transcription.segments)) {
      transcription.segments = normalizeSegments(transcription.segments);
      console.log(`Normalized ${transcription.segments.length} transcription segments`);
    }
    
    return transcription;
  } catch (err) {
    console.error('Transcription failed:', err.message);
    throw err;
  } finally {
    // Clean up temp file
    if (fs.existsSync(vocalsTempPath)) {
      fs.unlinkSync(vocalsTempPath);
      console.log(`Removed temp vocals file: ${vocalsTempPath}`);
    }
  }
};

/**
 * Update video document with audio keys
 * @param {Object} video - Video document
 * @param {Object} uploadResults - Upload results with audio keys
 */
const updateVideoWithAudioKeys = async (video, uploadResults) => {
  const { originalAudio, vocalsAudio, backgroundAudio } = uploadResults;
  
  if (originalAudio?.key && vocalsAudio?.key && backgroundAudio?.key) {
    video.audio.original = originalAudio.key;
    video.audio.voice = vocalsAudio.key;
    video.audio.background = backgroundAudio.key;
    await video.save();
    console.log('Database updated with audio keys');
  } else {
    video.status = variables.FAILED;
    video.error = 'Failed to upload extracted audio files';
    await video.save();
    throw new Error('Failed to upload extracted audio files');
  }
};

/**
 * Update video document with transcription results
 * @param {Object} video - Video document
 * @param {Object} transcription - Whisper transcription result
 */
const updateVideoWithTranscription = async (video, transcription) => {
  if (transcription && transcription.text) {
    video.ai.whisperOutput = transcription.text;
    if (transcription.language) {
      video.ai.sourceLanguage = transcription.language;
    }
    await video.save();
    console.log('Database updated with transcription');
  }
};

/**
 * Upload rewritten script to R2
 * @param {Array} rewrittenScript - Array of translated segments
 * @param {string} userId - User ID
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} Upload result with key
 */
const uploadRewrittenScript = async (rewrittenScript, userId, videoId) => {
  // Convert rewrittenScript array to JSON buffer
  const scriptJson = JSON.stringify(rewrittenScript, null, 2);
  const scriptBuffer = Buffer.from(scriptJson, 'utf-8');
  
  // Upload to R2
  const scriptDir = `scripts/${userId}/${videoId}`;
  const uploadedScript = await uploadFileFromBuffer(
    scriptBuffer,
    'application/json',
    scriptDir,
    'rewritten-script'
  );
  
  console.log('Rewritten script uploaded to R2:', uploadedScript.key);
  return uploadedScript;
};

/**
 * Update video document with rewritten script key
 * @param {Object} video - Video document
 * @param {Object} uploadResult - Upload result with key
 */
const updateVideoWithRewrittenScript = async (video, uploadResult) => {
  if (uploadResult?.key) {
    video.ai.rewrittenScript = uploadResult.key;
    await video.save();
    console.log('Database updated with rewritten script key');
  } else {
    throw new Error('Failed to upload rewritten script');
  }
};

module.exports = {
  streamToBuffer,
  removeDirectory,
  getVideoPaths,
  saveAudioToFile,
  readSeparatedAudioFiles,
  cleanupTempFiles,
  downloadVideo,
  processAudioSeparation,
  uploadAudioFiles,
  transcribeVocalsAudio,
  updateVideoWithAudioKeys,
  updateVideoWithTranscription,
  uploadRewrittenScript,
  updateVideoWithRewrittenScript,
};

