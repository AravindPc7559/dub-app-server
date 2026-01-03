const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { uploadFileFromBuffer } = require('./r2');
const {
  SAMPLE_RATE,
  createSilenceFile,
  getAudioDuration,
  adjustAudioSpeed,
} = require('./audioUtils');

/**
 * Build final audio by assembling TTS segments with silence gaps
 * @param {string} userId - User ID
 * @param {string} videoId - Video ID
 * @param {Array} rawSegments - Array of segment objects with TTS audio
 * @returns {Promise<Object>} Upload result from R2
 */
const buildFinalAudio = async (userId, videoId, rawSegments) => {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error("No segments provided for audio assembly");
  }

  const segments = rawSegments.map((item) => item.segment);
  const ttsDir = path.join(__dirname, '../tmp/tts', String(videoId));
  const silenceDir = path.join(ttsDir, 'silence');
  fs.mkdirSync(silenceDir, { recursive: true });

  // Build sequence of audio files and silence gaps
  const sequence = [];
  let silenceCounter = 1;

  // Add leading silence if needed
  if (segments[0].start > 0) {
    const silenceFile = path.join(silenceDir, `silence${silenceCounter}.wav`);
    createSilenceFile(silenceFile, segments[0].start);
    sequence.push(`silence${silenceCounter}.wav`);
    silenceCounter++;
  }

  // Add segments and gaps between them
  segments.forEach((segment, index) => {
    const audioFile = path.join(ttsDir, `segment-${index}.wav`);
    if (!fs.existsSync(audioFile)) {
      throw new Error(`TTS file not found for segment ${index}`);
    }

    sequence.push(`segment-${index}.wav`);

    // Add silence gap before next segment if needed
    if (index < segments.length - 1) {
      const nextSegment = segments[index + 1];
      const gap = nextSegment.start - segment.end;
      if (gap > 0.001) {
        const silenceFile = path.join(silenceDir, `silence${silenceCounter}.wav`);
        createSilenceFile(silenceFile, gap);
        sequence.push(`silence${silenceCounter}.wav`);
        silenceCounter++;
      }
    }
  });

  // Adjust segment durations to match target timing
  if (sequence.length > 1) {
    for (const item of sequence) {
      if (item.startsWith('segment-')) {
        const segmentIndex = parseInt(item.match(/segment-(\d+)/)?.[1]);
        if (segmentIndex === undefined || !segments[segmentIndex]) {
          continue;
        }

        const audioFile = path.join(ttsDir, item);
        if (!fs.existsSync(audioFile)) {
          continue;
        }

        const duration = getAudioDuration(audioFile);
        const targetDuration = segments[segmentIndex].end - segments[segmentIndex].start;
        const durationDiff = Math.abs(duration - targetDuration);

        if (durationDiff < 0.01) {
          continue;
        }

        const tempo = duration / targetDuration;
        const minTempo = 0.90; // Max 10% slowdown

        if (duration > targetDuration || (duration < targetDuration && tempo >= minTempo)) {
          const adjustedFile = path.join(ttsDir, `segment-${segmentIndex}_final.wav`);
          await adjustAudioSpeed(audioFile, adjustedFile, tempo);

          const trimmedFile = path.join(ttsDir, `segment-${segmentIndex}_trimmed.wav`);
          const trimCmd = `ffmpeg -y -i "${adjustedFile}" -t ${targetDuration.toFixed(3)} "${trimmedFile}"`;
          execSync(trimCmd, { stdio: 'pipe' });

          const itemIndex = sequence.indexOf(`segment-${segmentIndex}.wav`);
          if (itemIndex !== -1) {
            sequence[itemIndex] = `segment-${segmentIndex}_trimmed.wav`;
          }
        }
      }
    }
  }

  // Build concatenation list
  const concatFile = path.join(ttsDir, 'concat_list.txt');
  const concatLines = [];

  for (const item of sequence) {
    const fullPath = item.startsWith('silence')
      ? path.join(silenceDir, item)
      : path.join(ttsDir, item);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found for concatenation: ${fullPath}`);
    }

    const absolutePath = path.resolve(fullPath);
    const escapedPath = absolutePath.replace(/'/g, "'\\''");
    concatLines.push(`file '${escapedPath}'`);
  }

  fs.writeFileSync(concatFile, concatLines.join('\n'), 'utf8');

  // Concatenate all files
  const finalAudio = path.join(ttsDir, 'final_dub_audio.wav');
  const concatFileAbs = path.resolve(concatFile);
  const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFileAbs}" -c:a pcm_s16le -ar ${SAMPLE_RATE} -ac 2 "${finalAudio}"`;

  execSync(ffmpegCmd, { stdio: 'inherit' });

  if (!fs.existsSync(finalAudio)) {
    throw new Error("Final audio file was not created");
  }

  // Upload to R2
  const uploadResult = await uploadFileFromBuffer(
    fs.readFileSync(finalAudio),
    "audio/wav",
    `dubbed/${userId}/${videoId}`,
    "final_dub_audio"
  );

  return uploadResult;
};

module.exports = {
  buildFinalAudio
};