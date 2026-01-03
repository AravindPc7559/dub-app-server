const fs = require('fs');
const path = require('path');
const { getFile, uploadFileFromBuffer } = require('./r2');
const { runDemucs } = require('../services/demucs.service');
const { transcribeAudio } = require('../services/whisper.service');
const { generateTTSBuffer } = require('../services/azure_tts.service');
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
async function cleanupTempFiles(jobId) {
  const pathsToClean = [
    path.join("tmp", "tts", jobId),
    path.join("tmp", "htdemucs", "htdemucs", `${jobId}_audio`),
    path.join("tmp", "final", jobId),
    path.join("tmp", `${jobId}_vocals_temp.mp3`),
    path.join("tmp", `${jobId}_audio.wav`),
  ];

  await Promise.all(
    pathsToClean.map(async (itemPath) => {
      try {
        // Check if path exists
        const exists = await fs.promises.access(itemPath).then(() => true).catch(() => false);
        if (!exists) {
          return; // Skip if doesn't exist
        }

        // Check if it's a directory or file
        const stats = await fs.promises.stat(itemPath);
        
        if (stats.isDirectory()) {
          // Delete directory recursively
          await fs.promises.rm(itemPath, {
            recursive: true,
            force: true,
          });
          console.log(`✅ Deleted directory: ${itemPath}`);
        } else if (stats.isFile()) {
          // Delete file
          await fs.promises.unlink(itemPath);
          console.log(`✅ Deleted file: ${itemPath}`);
        }
      } catch (err) {
        // Ignore ENOENT errors (file/directory doesn't exist)
        if (err.code !== 'ENOENT') {
          console.error(`❌ Failed to delete ${itemPath}:`, err.message);
        }
      }
    })
  );
}

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
  // Validate audio duration before processing
  const { getAudioDuration } = require('./video');
  const MIN_AUDIO_DURATION = 1.0;

  try {
    const duration = await getAudioDuration(audioFilePath);

    if (duration && duration < MIN_AUDIO_DURATION) {
      throw new Error(
        `Audio is too short for Demucs processing. `+
        `Minimum duration required is ${MIN_AUDIO_DURATION} seconds.`
      );
    }
  } catch (err) {
    throw new Error(err)
  }

  const { vocalsPath, backgroundPath } = await runDemucs(audioFilePath, demucsOutputDir);
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
  try {
    const audioDir = `extracted-audio/${userId}/${videoId}`;

    const [originalAudio, vocalsAudio, backgroundAudio] = await Promise.all([
      uploadFileFromBuffer(originalBuffer, 'audio/wav', audioDir, 'original'),
      uploadFileFromBuffer(vocalsBuffer, 'audio/mpeg', audioDir, 'vocals'),
      uploadFileFromBuffer(backgroundBuffer, 'audio/mpeg', audioDir, 'background')
    ]);
  
    return { originalAudio, vocalsAudio, backgroundAudio };
  } catch (error) {
    throw new Error(error)
  }
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

    // Transcribe using Whisper (uses language if provided and supported, otherwise auto-detects)
    const transcription = await transcribeAudio(vocalsTempPath, language);
    console.log('Audio transcription completed');

    // Normalize segments if they exist
    if (transcription.segments && Array.isArray(transcription.segments)) {
      transcription.segments = normalizeSegments(transcription.segments);
    }

    return transcription;
  } catch (err) {
    console.error('Transcription failed:', err.message);
    throw err;
  }

};

/**
 * Update video document with audio keys
 * @param {Object} video - Video document
 * @param {Object} uploadResults - Upload results with audio keys
 */
const updateVideoWithAudioKeys = async (video, uploadResults) => {
  const { originalAudio, vocalsAudio, backgroundAudio, tts } = uploadResults;

  if (originalAudio?.key && vocalsAudio?.key && backgroundAudio?.key && tts.key) {
    video.audio.original = originalAudio.key;
    video.audio.voice = vocalsAudio.key;
    video.audio.background = backgroundAudio.key;
    video.audio.tts = tts.key
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
  try {
    if (transcription && transcription.text) {
      video.ai.whisperOutput = transcription.text;
      if (transcription.language) {
        video.ai.sourceLanguage = transcription.language;
      }
      await video.save();
      console.log('Database updated with transcription');
    }
  } catch (error) {
    throw new Error(error)
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
  try {
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

    console.log('Rewritten script uploaded to R2');
    return uploadedScript;
  } catch (error) {
    throw new Error(error)
  }
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

/**
 * Generate TTS audio for all segments in rewritten script and save locally
 * @param {Array} rewrittenScript - Array of segments with text and emotion
 * @param {string|ObjectId} videoId - Video ID for folder naming
 * @param {string} voice - Voice to use for TTS (optional, will use language-based voice if not provided)
 * @param {string} targetLanguage - Target language code (e.g., 'en', 'hi', 'ml')
 * @returns {Promise<Array>} Array of file paths and segment info
 */
const generateTTSForSegments = async (rewrittenScript, videoId, voice = null, targetLanguage = 'en') => {
  // Convert videoId to string (handles both string and ObjectId)
  const videoIdStr = videoId?.toString ? videoId.toString() : String(videoId);
  const ttsDir = path.join(__dirname, '../tmp/tts', videoIdStr);
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`Generating TTS for ${rewrittenScript.length} segments with Azure TTS`);
  console.log(`Target language: ${targetLanguage}, Voice: ${voice || 'auto'}`);
  console.log(`Saving TTS files to: ${ttsDir}`);

  const results = [];
  const DELAY_BETWEEN_REQUESTS = 200; // 200ms delay between requests to avoid rate limits
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE = 1000; // 1 second base delay for retries

  // Process segments sequentially to avoid rate limiting
  for (let index = 0; index < rewrittenScript.length; index++) {
    const segment = rewrittenScript[index];
    let retryCount = 0;
    let success = false;

    while (!success && retryCount <= MAX_RETRIES) {
      try {
        // Add delay before each request (except first one)
        if (index > 0) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
        }

        const audioBuffer = await generateTTSBuffer({
          text: segment.text,
          voice,
          emotion: segment.emotion || 'neutral',
          targetLanguage
        });

        // Validate buffer before saving
        if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
          throw new Error(`Invalid audio buffer generated for segment ${index + 1}`);
        }

        // Validate minimum file size (WAV header is typically 44 bytes, but valid audio should be larger)
        if (audioBuffer.length < 1000) {
          throw new Error(`Audio buffer too small for segment ${index + 1} (${audioBuffer.length} bytes)`);
        }

        // Save to local file
        const fileName = `segment-${index}.wav`;
        const filePath = path.join(ttsDir, fileName);
        fs.writeFileSync(filePath, audioBuffer);

        // Verify file was written correctly
        if (!fs.existsSync(filePath)) {
          throw new Error(`Failed to save TTS file: ${filePath}`);
        }

        const fileStats = fs.statSync(filePath);
        if (fileStats.size !== audioBuffer.length) {
          throw new Error(`File size mismatch for ${filePath}: expected ${audioBuffer.length}, got ${fileStats.size}`);
        }

        console.log(`TTS generated and saved for segment ${index + 1}/${rewrittenScript.length}: ${filePath} (${fileStats.size} bytes)`);
        
        results.push({
          segmentIndex: index,
          filePath,
          audioBuffer, // Keep buffer for potential later use
          segment
        });
        
        success = true;
      } catch (err) {
        const isRateLimitError = err.message && (
          err.message.includes('ResourceExhausted') ||
          err.message.includes('no tokens available') ||
          err.message.includes('rate limit') ||
          err.message.includes('quota')
        );

        if (isRateLimitError && retryCount < MAX_RETRIES) {
          retryCount++;
          const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount - 1); // Exponential backoff
          console.warn(
            `Rate limit hit for segment ${index + 1}, retrying in ${retryDelay}ms (attempt ${retryCount}/${MAX_RETRIES})...`
          );
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.error(`Failed to generate TTS for segment ${index + 1}:`, err.message);
          throw new Error(`TTS generation failed for segment ${index + 1}: ${err.message}`);
        }
      }
    }
  }

  console.log(`All TTS audio generated and saved locally (${results.length} files)`);
  return results;
};

/**
 * Get TTS directory path for a video
 * @param {string|ObjectId} videoId - Video ID
 * @returns {string} Path to TTS directory
 */
const getTTSDirectory = (videoId) => {
  // Convert videoId to string (handles both string and ObjectId)
  const videoIdStr = videoId?.toString ? videoId.toString() : String(videoId);
  return path.join(__dirname, '../tmp/tts', videoIdStr);
};

/**
 * Upload TTS audio files to R2 (for later use)
 * @param {Array} ttsResults - Array of TTS results with file paths
 * @param {string} userId - User ID
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} Upload results with keys
 */
const uploadTTSAudio = async (ttsResults, userId, videoId) => {
  const ttsDir = `tts-audio/${userId}/${videoId}`;

  console.log(`Uploading ${ttsResults.length} TTS audio files to R2`);

  const uploadPromises = ttsResults.map(async (result) => {
    // Read the file from local storage
    const audioBuffer = fs.readFileSync(result.filePath);
    const fileName = `segment-${result.segmentIndex}`;
    const uploaded = await uploadFileFromBuffer(
      audioBuffer,
      'audio/wav',
      ttsDir,
      fileName
    );
    return {
      segmentIndex: result.segmentIndex,
      key: uploaded.key,
      segment: result.segment
    };
  });

  const uploadResults = await Promise.all(uploadPromises);
  console.log('All TTS audio files uploaded to R2');

  return uploadResults;
};

/**
 * Update video document with TTS audio keys
 * @param {Object} video - Video document
 * @param {Array} uploadResults - Upload results with TTS audio keys
 */
const updateVideoWithTTSAudio = async (video, uploadResult) => {
  if (uploadResult) {
    video.outputVideo.downloadUrl = uploadResult.url;
    video.outputVideo.s3Key = uploadResult.key;
    await video.save();
    console.log(`Database updated with TTS audio key (${uploadResult.length} segments)`);
  } else {
    throw new Error('No TTS audio files to update');
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
  generateTTSForSegments,
  getTTSDirectory,
  uploadTTSAudio,
  updateVideoWithTTSAudio,
};

