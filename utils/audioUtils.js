const fs = require('fs');
const { execSync } = require('child_process');

const SAMPLE_RATE = 44100;

/**
 * Create a silence audio file
 * @param {string} outputPath - Path to output silence file
 * @param {number} duration - Duration in seconds
 */
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

/**
 * Normalize and enhance audio with EQ and compression for more natural sound
 * @param {string} inputPath - Path to input audio file
 * @param {string} outputPath - Path to output audio file
 * @returns {string} Path to output file
 */
function normalizeAndEnhanceAudio(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input audio file not found: ${inputPath}`);
  }

  // Apply audio normalization, EQ, and subtle compression for natural sound
  // - Normalize to -1dB peak (leaves headroom)
  // - Subtle EQ: slight boost in mid frequencies (1-3kHz) for clarity
  // - Subtle compression: smooth dynamics without over-compression
  // - High-pass filter: remove low-frequency rumble below 80Hz
  const ffmpegCmd = `ffmpeg -y -i "${inputPath}" ` +
    `-af "highpass=f=80,` +
    `equalizer=f=1000:width_type=h:width=1000:g=1.5,` +
    `equalizer=f=2000:width_type=h:width=1000:g=1.2,` +
    `acompressor=threshold=-18dB:ratio=3:attack=5:release=50,` +
    `loudnorm=I=-16:TP=-1.5:LRA=11" ` +
    `-ar ${SAMPLE_RATE} -ac 2 -acodec pcm_s16le "${outputPath}"`;
  
  execSync(ffmpegCmd, { stdio: 'pipe' });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to create normalized audio file: ${outputPath}`);
  }

  return outputPath;
}

module.exports = {
  SAMPLE_RATE,
  createSilenceFile,
  getAudioDuration,
  adjustAudioSpeed,
  normalizeAndEnhanceAudio,
};

