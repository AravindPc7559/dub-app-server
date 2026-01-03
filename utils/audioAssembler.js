const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { uploadFileFromBuffer } = require('./r2');

const SAMPLE_RATE = 44100;

// Create a silence file
function createSilenceFile(outputPath, duration) {
  if (duration <= 0) {
    throw new Error(`Invalid silence duration: ${duration}`);
  }

  const ffmpegCmd = `ffmpeg -y -f lavfi -i anullsrc=r=${SAMPLE_RATE}:cl=stereo -t ${duration.toFixed(3)} -acodec pcm_s16le -ar ${SAMPLE_RATE} -ac 2 -f wav "${outputPath}"`;
  execSync(ffmpegCmd, { stdio: 'pipe' });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to create silence file: ${outputPath}`);
  }
}

// Find Duration of the audio file
/**
 * Get audio duration using ffprobe
 * @param {string} filePath - Path to audio file
 * @returns {number} Duration in seconds
 */
function getAudioDuration(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const output = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
  );
  const duration = parseFloat(output.toString().trim());

  if (isNaN(duration) || duration <= 0) {
    throw new Error(`Invalid duration for file: ${filePath}`);
  }

  return duration;
}

/**
 * Adjust audio speed (slow down or speed up) using FFmpeg atempo
 * @param {string} inputPath - Path to input audio file
 * @param {string} outputPath - Path to output audio file
 * @param {number} tempo - Tempo multiplier (0.5 = half speed, 1.0 = normal, 2.0 = double speed)
 * @returns {string} Path to output file
 */
async function adjustAudioSpeed(inputPath, outputPath, tempo) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input audio file not found: ${inputPath}`);
  }

  if (tempo <= 0 || tempo > 4.0) {
    throw new Error(`Invalid tempo: ${tempo}. Must be between 0.5 and 4.0`);
  }

  // FFmpeg atempo filter has limits: 0.5 to 2.0 per filter
  // For values outside this range, we need to chain multiple filters
  let ffmpegFilters = [];
  let remainingTempo = tempo;

  // Handle speeds slower than 0.5 (e.g., 0.25 = 0.5 * 0.5)
  while (remainingTempo < 0.5) {
    ffmpegFilters.push('atempo=0.5');
    remainingTempo /= 0.5;
  }

  // Handle speeds faster than 2.0 (e.g., 4.0 = 2.0 * 2.0)
  while (remainingTempo > 2.0) {
    ffmpegFilters.push('atempo=2.0');
    remainingTempo /= 2.0;
  }

  // Add final tempo if needed
  if (Math.abs(remainingTempo - 1.0) > 0.01) {
    ffmpegFilters.push(`atempo=${remainingTempo.toFixed(3)}`);
  }

  // If no filters needed (tempo = 1.0), just copy the file
  if (ffmpegFilters.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return outputPath;
  }

  // Apply tempo adjustment
  const filterChain = ffmpegFilters.join(',');
  const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -af "${filterChain}" "${outputPath}"`;
  execSync(ffmpegCmd, { stdio: 'pipe' });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to create adjusted audio file: ${outputPath}`);
  }

  return outputPath;
}

const buildFinalAudio = async (userId, videoId, rawSegments) => {
  try {
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
      throw new Error("No segments provided for audio assembly");
    }
    const segments = rawSegments?.map((item) => item.segment)
    console.log("the segments", segments)

    const ttsDir = path.join(__dirname, '../tmp/tts', String(videoId));
    const silenceDir = path.join(ttsDir, 'silence');
    fs.mkdirSync(silenceDir, { recursive: true });

    const sequence = [];
    let silenceCounter = 1;

    if (segments[0].start > 0) {
      const leadingSilenceDuration = segments[0].start;
      const silenceFile = path.join(silenceDir, `silence${silenceCounter}.wav`);
      createSilenceFile(silenceFile, leadingSilenceDuration);
      sequence.push(`silence${silenceCounter}.wav`);
      silenceCounter++;
    }


    segments.forEach((segment, index) => {
      const { start, end } = segment;
      const audioFile = path.join(ttsDir, `segment-${index}.wav`);

      if (!fs.existsSync(audioFile)) {
        throw new Error(`TTS file not found for segment ${index}`);
      }

      sequence.push(`segment-${index}.wav`);

      if (index < segments.length - 1) {
        const nextSegment = segments[index + 1];
        const gap = nextSegment.start - end;
        console.log("the gap", gap)

        if (gap > 0.001) {
          const silenceFile = path.join(silenceDir, `silence${silenceCounter}.wav`);
          console.log("the silence file", silenceFile)
          createSilenceFile(silenceFile, gap);
          sequence.push(`silence${silenceCounter}.wav`);
          silenceCounter++;
        }
      }
    });

    console.log("the sequence", sequence)

    const sequenceFile = path.join(ttsDir, 'audio_sequence.txt');
    const sequenceContent = sequence.join('\n');
    fs.writeFileSync(sequenceFile, sequenceContent, 'utf8');

    if (sequence.length > 1) {
      sequence.forEach((item, sequenceIndex) => {
        if (item.startsWith('segment-')) {
          const segmentIndex = parseInt(item.match(/segment-(\d+)/)?.[1]);
          if (segmentIndex === undefined || !segments[segmentIndex]) {
            return;
          }

          const audioFile = path.join(ttsDir, item);
          if (fs.existsSync(audioFile)) {
            const duration = getAudioDuration(audioFile);
            const targetDuration = segments[segmentIndex].end - segments[segmentIndex].start;

            if (Math.abs(duration - targetDuration) < 0.01) {
              return;
            }

            if (duration > targetDuration) {
              console.log(`Segment ${segmentIndex}: duration (${duration.toFixed(2)}s) > target (${targetDuration.toFixed(2)}s)`);

              const tempo = duration / targetDuration;
              const adjustedFile = path.join(ttsDir, `segment-${segmentIndex}_final.wav`);
              adjustAudioSpeed(audioFile, adjustedFile, tempo);

              const trimmedFile = path.join(ttsDir, `segment-${segmentIndex}_trimmed.wav`);
              const trimCmd = `ffmpeg -y -i "${adjustedFile}" -t ${targetDuration.toFixed(3)} "${trimmedFile}"`;
              execSync(trimCmd, { stdio: 'pipe' });

              const sequenceIndex = sequence.indexOf(`segment-${segmentIndex}.wav`);
              if (sequenceIndex !== -1) {
                sequence[sequenceIndex] = `segment-${segmentIndex}_trimmed.wav`;
              }

              console.log(`Segment ${segmentIndex}: Sped up ${tempo.toFixed(2)}x to match target`);

            } else {
              console.log(`Segment ${segmentIndex}: duration (${duration.toFixed(2)}s) < target (${targetDuration.toFixed(2)}s)`);

              const tempo = duration / targetDuration;
              const minTempo = 0.90; // 10% slowdown max

              if (tempo >= minTempo) {
                const adjustedFile = path.join(ttsDir, `segment-${segmentIndex}_final.wav`);
                adjustAudioSpeed(audioFile, adjustedFile, tempo);

                const trimmedFile = path.join(ttsDir, `segment-${segmentIndex}_trimmed.wav`);
                const trimCmd = `ffmpeg -y -i "${adjustedFile}" -t ${targetDuration.toFixed(3)} "${trimmedFile}"`;
                execSync(trimCmd, { stdio: 'pipe' });

                const sequenceIndex = sequence.indexOf(`segment-${segmentIndex}.wav`);
                if (sequenceIndex !== -1) {
                  sequence[sequenceIndex] = `segment-${segmentIndex}_trimmed.wav`;
                }

                console.log(`Segment ${segmentIndex}: Slowed down ${tempo.toFixed(2)}x to match target`);
              } else {
                console.log(`Segment ${segmentIndex}: Too short (${(targetDuration - duration).toFixed(2)}s gap) - using as-is`);
              }
            }
          }
        }
      })
    }

    // stitiching together the audio files
    const concatFile = path.join(ttsDir, 'concat_list.txt');
    const concatLines = [];

    sequence.forEach((item) => {
      let fullPath;

      if (item.startsWith('silence')) {
        // Silence files are in silence directory
        fullPath = path.join(silenceDir, item);
      } else {
        // Segment files are in tts directory (could be segment-X.wav or segment-X_trimmed.wav)
        fullPath = path.join(ttsDir, item);
      }

      // Verify file exists
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found for concatenation: ${fullPath}`);
      }

      // Convert to absolute path and escape single quotes for FFmpeg
      const absolutePath = path.resolve(fullPath);
      const escapedPath = absolutePath.replace(/'/g, "'\\''");
      concatLines.push(`file '${escapedPath}'`);
    });

    // Step 3: Write concat list file
    fs.writeFileSync(concatFile, concatLines.join('\n'), 'utf8');
    console.log(`Concat list created with ${concatLines.length} files`);

    // Step 4: Concatenate all files using FFmpeg
    const finalAudio = path.join(ttsDir, 'final_dub_audio.wav');
    const concatFileAbs = path.resolve(concatFile);
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFileAbs}" -c:a pcm_s16le -ar ${SAMPLE_RATE} -ac 2 "${finalAudio}"`;

    console.log(`Concatenating ${sequence.length} files into final audio...`);
    execSync(ffmpegCmd, { stdio: 'inherit' });

    // Step 5: Verify final audio was created
    if (!fs.existsSync(finalAudio)) {
      throw new Error("Final audio file was not created");
    }

    console.log(`Final audio created: ${finalAudio}`);

    const uploadResult = await uploadFileFromBuffer(
      fs.readFileSync(finalAudio),
      "audio/wav",
      `dubbed/${userId}/${videoId}`,
      "final_dub_audio"
    );
    return uploadResult;


  } catch (error) {
    throw new Error(error);
  }
};

module.exports = {
  buildFinalAudio
};