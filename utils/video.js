const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

const getVideoDuration = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = Readable.from(buffer);
    let timeout;
    
    const timeoutDuration = 30000;
    
    timeout = setTimeout(() => {
      reject(new Error('Video duration check timed out'));
    }, timeoutDuration);
    
    ffmpeg(stream)
      .ffprobe((err, metadata) => {
        clearTimeout(timeout);
        
        if (err) {
          reject(new Error(`Failed to get video duration: ${err.message}`));
          return;
        }
        
        if (!metadata || !metadata.format || !metadata.format.duration) {
          reject(new Error('Could not determine video duration'));
          return;
        }
        
        const duration = metadata.format.duration;
        resolve(Math.ceil(duration));
      });
  });
};

/**
 * Get audio file duration and validate it
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<number>} Duration in seconds
 */
const getAudioDuration = (audioFilePath) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioFilePath)) {
      return reject(new Error(`Audio file not found: ${audioFilePath}`));
    }

    let timeout;
    const timeoutDuration = 30000;
    
    timeout = setTimeout(() => {
      reject(new Error('Audio duration check timed out'));
    }, timeoutDuration);
    
    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      clearTimeout(timeout);
      
      if (err) {
        reject(new Error(`Failed to get audio duration: ${err.message}`));
        return;
      }
      
      if (!metadata || !metadata.format || !metadata.format.duration) {
        reject(new Error('Could not determine audio duration'));
        return;
      }
      
      const duration = metadata.format.duration;
      resolve(duration);
    });
  });
};

/**
 * Format time for SRT subtitle format (HH:MM:SS,mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
const formatSRTTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};

/**
 * Format time for WebVTT subtitle format (HH:MM:SS.mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
const formatVTTTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
};

/**
 * Extract a thumbnail frame from video buffer
 * @param {Buffer} videoBuffer - Video file buffer
 * @param {number} timestamp - Timestamp in seconds to extract frame (default: 1 second)
 * @returns {Promise<Buffer>} Thumbnail image buffer (JPEG)
 */
const extractThumbnail = (videoBuffer, timestamp = 1) => {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../tmp');
    const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
    const thumbnailPath = path.join(tempDir, `thumbnail_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let timeout;
    const timeoutDuration = 30000; // 30 seconds
    
    const cleanup = () => {
      if (fs.existsSync(tempVideoPath)) {
        try { fs.unlinkSync(tempVideoPath); } catch (e) {}
      }
      if (fs.existsSync(thumbnailPath)) {
        try { fs.unlinkSync(thumbnailPath); } catch (e) {}
      }
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail extraction timed out'));
    }, timeoutDuration);

    // Write video buffer to temp file
    fs.writeFileSync(tempVideoPath, videoBuffer);

    // Extract thumbnail using ffmpeg
    ffmpeg(tempVideoPath)
      .seekInput(timestamp)
      .frames(1)
      .size('1280x720')
      .output(thumbnailPath)
      .on('end', () => {
        clearTimeout(timeout);
        try {
          if (fs.existsSync(thumbnailPath)) {
            const thumbnailBuffer = fs.readFileSync(thumbnailPath);
            cleanup();
            resolve(thumbnailBuffer);
          } else {
            cleanup();
            reject(new Error('Thumbnail file was not created'));
          }
        } catch (error) {
          cleanup();
          reject(new Error(`Failed to read thumbnail: ${error.message}`));
        }
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Thumbnail extraction failed: ${err.message}`));
      })
      .run();
  });
};

module.exports = {
  getVideoDuration,
  getAudioDuration,
  formatSRTTime,
  formatVTTTime,
  extractThumbnail,
};

