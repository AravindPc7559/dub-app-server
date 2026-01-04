const fs = require('fs');
const path = require('path');
const { getFile, uploadFileFromBuffer } = require('./r2');
const { runDemucs } = require('../services/demucs.service');
const { transcribeAudio } = require('../services/whisper.service');
const { generateTTSBuffer } = require('../services/azure_tts.service');
const { normalizeSegments } = require('./openAiUtils');
const variables = require('../const/variables');

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

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

const saveAudioToFile = (audioBuffer, audioFilePath) => {
  const tmpDir = path.dirname(audioFilePath);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(audioFilePath, audioBuffer);
};

const readSeparatedAudioFiles = (vocalsPath, backgroundPath) => {
  const vocalsBuffer = fs.readFileSync(vocalsPath);
  const backgroundBuffer = fs.readFileSync(backgroundPath);
  return { vocalsBuffer, backgroundBuffer };
};

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
        const exists = await fs.promises.access(itemPath).then(() => true).catch(() => false);
        if (!exists) return;

        const stats = await fs.promises.stat(itemPath);
        if (stats.isDirectory()) {
          await fs.promises.rm(itemPath, { recursive: true, force: true });
        } else if (stats.isFile()) {
          await fs.promises.unlink(itemPath);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Failed to delete ${itemPath}:`, err.message);
        }
      }
    })
  );
}

const downloadVideo = async (s3Key) => {
  const videoResponse = await getFile(s3Key);
  return await streamToBuffer(videoResponse.Body);
};

const processAudioSeparation = async (audioFilePath, demucsOutputDir) => {
  const { getAudioDuration } = require('./video');
  const MIN_AUDIO_DURATION = 1.0;

  try {
    const duration = await getAudioDuration(audioFilePath);
    if (duration && duration < MIN_AUDIO_DURATION) {
      throw new Error(`Audio too short for Demucs. Minimum: ${MIN_AUDIO_DURATION}s`);
    }
  } catch (err) {
    throw new Error(err);
  }

  const { vocalsPath, backgroundPath } = await runDemucs(audioFilePath, demucsOutputDir);
  return readSeparatedAudioFiles(vocalsPath, backgroundPath);
};

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
    throw new Error(error);
  }
};

const transcribeVocalsAudio = async (vocalsBuffer, videoId, language = null) => {
  const tmpDir = path.join(__dirname, '../tmp');
  const vocalsTempPath = path.join(tmpDir, `${videoId}_vocals_temp.mp3`);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(vocalsTempPath, vocalsBuffer);
    const transcription = await transcribeAudio(vocalsTempPath, language);

    if (transcription.segments && Array.isArray(transcription.segments)) {
      transcription.segments = normalizeSegments(transcription.segments);
    }

    return transcription;
  } catch (err) {
    console.error('Transcription failed:', err.message);
    throw err;
  }
};

const updateVideoWithAudioKeys = async (video, uploadResults) => {
  const { originalAudio, vocalsAudio, backgroundAudio, tts } = uploadResults;

  if (originalAudio?.key && vocalsAudio?.key && backgroundAudio?.key && tts.key) {
    video.audio.original = originalAudio.key;
    video.audio.voice = vocalsAudio.key;
    video.audio.background = backgroundAudio.key;
    video.audio.tts = tts.key;
    await video.save();
  } else {
    video.status = variables.FAILED;
    video.error = 'Failed to upload extracted audio files';
    await video.save();
    throw new Error('Failed to upload extracted audio files');
  }
};

const updateVideoWithTranscription = async (video, transcription) => {
  try {
    if (transcription && transcription.text) {
      video.ai.whisperOutput = transcription.text;
      if (transcription.language) {
        video.ai.sourceLanguage = transcription.language;
      }
      await video.save();
    }
  } catch (error) {
    throw new Error(error);
  }
};

const uploadRewrittenScript = async (rewrittenScript, userId, videoId) => {
  try {
    const scriptJson = JSON.stringify(rewrittenScript, null, 2);
    const scriptBuffer = Buffer.from(scriptJson, 'utf-8');
    const scriptDir = `scripts/${userId}/${videoId}`;
    return await uploadFileFromBuffer(scriptBuffer, 'application/json', scriptDir, 'rewritten-script');
  } catch (error) {
    throw new Error(error);
  }
};

const updateVideoWithRewrittenScript = async (video, uploadResult) => {
  if (uploadResult?.key) {
    video.ai.rewrittenScript = uploadResult.key;
    await video.save();
  } else {
    throw new Error('Failed to upload rewritten script');
  }
};

const generateTTSForSegments = async (rewrittenScript, videoId, voice = null, targetLanguage = 'en') => {
  const videoIdStr = videoId?.toString ? videoId.toString() : String(videoId);
  const ttsDir = path.join(__dirname, '../tmp/tts', videoIdStr);
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`[TTS] Generating ${rewrittenScript.length} segments (parallel)`);

  const results = [];
  const CONCURRENT_SEGMENTS = 5;
  const DELAY_BETWEEN_BATCHES = 50;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE = 1000;
  const MAX_EXPANSION_ATTEMPTS = 1;
  const EXPANSION_THRESHOLD = 0.15;
  const { getAudioDuration } = require('./video');
  const { expandSegmentText } = require('../services/gptTranslate.service');
  const { LANGUAGE_MAP } = require('../const/openAiLanguages');

  for (let i = 0; i < rewrittenScript.length; i += CONCURRENT_SEGMENTS) {
    const batch = rewrittenScript.slice(i, i + CONCURRENT_SEGMENTS);
    const batchStartIndex = i;
    
    const batchResults = await Promise.allSettled(batch.map(async (segment, batchIndex) => {
      const index = batchStartIndex + batchIndex;
      let retryCount = 0;
      let success = false;
      let currentSegment = segment;
      let expansionAttempts = 0;

      while (!success && retryCount <= MAX_RETRIES) {
        try {
          const targetDuration = segment.end - segment.start;
          const audioBuffer = await generateTTSBuffer({
            text: currentSegment.text,
            voice,
            emotion: currentSegment.emotion || 'neutral',
            targetLanguage,
            duration: null,
            ssml: currentSegment.ssml || null
          });

          if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
            throw new Error(`Invalid audio buffer for segment ${index + 1}`);
          }

          if (audioBuffer.length < 1000) {
            throw new Error(`Audio buffer too small for segment ${index + 1}`);
          }

          const shouldCheckDuration = 
            currentSegment.text.length < 20 ||
            targetDuration > 5 ||
            expansionAttempts > 0;

          let actualDuration = null;
          let tempFile = null;

          if (shouldCheckDuration) {
            tempFile = path.join(ttsDir, `segment-${index}_temp.wav`);
            fs.writeFileSync(tempFile, audioBuffer);
            actualDuration = await getAudioDuration(tempFile);
            const durationDiff = targetDuration - actualDuration;
            const durationDiffPercent = (durationDiff / targetDuration) * 100;

            if (durationDiff > EXPANSION_THRESHOLD && expansionAttempts < MAX_EXPANSION_ATTEMPTS) {
              console.log(`[TTS] Segment ${index + 1} too short (${durationDiffPercent.toFixed(1)}%), expanding...`);
              currentSegment = await expandSegmentText({
                segment: currentSegment,
                actualDuration,
                targetDuration,
                targetLanguage: LANGUAGE_MAP[targetLanguage] || targetLanguage,
                targetLanguageCode: targetLanguage,
                voice
              });
              expansionAttempts++;
              if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
              continue;
            }
          }

          const filePath = path.join(ttsDir, `segment-${index}.wav`);
          
          if (tempFile && fs.existsSync(tempFile)) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            fs.renameSync(tempFile, filePath);
          } else {
            fs.writeFileSync(filePath, audioBuffer);
          }

          if (!fs.existsSync(filePath)) {
            throw new Error(`Failed to save TTS file: ${filePath}`);
          }
          
          return {
            segmentIndex: index,
            filePath,
            audioBuffer,
            segment: currentSegment
          };
        } catch (err) {
          const isRateLimitError = err.message && (
            err.message.includes('ResourceExhausted') ||
            err.message.includes('no tokens available') ||
            err.message.includes('rate limit') ||
            err.message.includes('quota')
          );

          if (isRateLimitError && retryCount < MAX_RETRIES) {
            retryCount++;
            const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount - 1);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            throw new Error(`TTS generation failed for segment ${index + 1}: ${err.message}`);
          }
        }
      }
      
      throw new Error(`Failed to generate TTS for segment ${index + 1} after ${MAX_RETRIES} retries`);
    }));

    batchResults.forEach((result, batchIndex) => {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      } else if (result.status === 'rejected') {
        const index = batchStartIndex + batchIndex;
        console.error(`[TTS] Segment ${index + 1} failed:`, result.reason?.message || result.reason);
      }
    });

    if (i + CONCURRENT_SEGMENTS < rewrittenScript.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  if (results.length !== rewrittenScript.length) {
    const missingSegments = [];
    const generatedIndices = new Set(results.map(r => r.segmentIndex));
    for (let i = 0; i < rewrittenScript.length; i++) {
      if (!generatedIndices.has(i)) {
        missingSegments.push(i + 1);
      }
    }
    throw new Error(
      `Failed to generate TTS for ${rewrittenScript.length - results.length} segments. ` +
      `Missing: ${missingSegments.join(', ')}`
    );
  }

  console.log(`[TTS] Generated ${results.length} segments`);
  results.sort((a, b) => a.segmentIndex - b.segmentIndex);
  return results;
};

const getTTSDirectory = (videoId) => {
  const videoIdStr = videoId?.toString ? videoId.toString() : String(videoId);
  return path.join(__dirname, '../tmp/tts', videoIdStr);
};

const uploadTTSAudio = async (ttsResults, userId, videoId) => {
  const ttsDir = `tts-audio/${userId}/${videoId}`;
  const uploadPromises = ttsResults.map(async (result) => {
    const audioBuffer = fs.readFileSync(result.filePath);
    const fileName = `segment-${result.segmentIndex}`;
    const uploaded = await uploadFileFromBuffer(audioBuffer, 'audio/wav', ttsDir, fileName);
    return {
      segmentIndex: result.segmentIndex,
      key: uploaded.key,
      segment: result.segment
    };
  });
  return await Promise.all(uploadPromises);
};

const updateVideoWithTTSAudio = async (video, uploadResult) => {
  if (uploadResult) {
    video.outputVideo.downloadUrl = uploadResult.url;
    video.outputVideo.s3Key = uploadResult.key;
    await video.save();
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

