const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { Readable, PassThrough } = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

const extractAudio = async (videoBuffer, outputFormat = 'wav') => {
 try {
  return new Promise((resolve, reject) => {
    const audioChunks = [];
    const videoStream = Readable.from(videoBuffer);
    const outputStream = new PassThrough();

    outputStream.on('data', (chunk) => {
      audioChunks.push(chunk);
    });

    outputStream.on('end', () => {
      const audioBuffer = Buffer.concat(audioChunks);
      resolve(audioBuffer);
    });

    outputStream.on('error', (err) => {
      reject(new Error(`Audio extraction stream error: ${err.message}`));
    });

    ffmpeg(videoStream)
      .toFormat(outputFormat)
      .audioCodec('pcm_s16le')
      .audioFrequency(44100)
      .audioChannels(2)
      .noVideo()
      .on('error', (err) => {
        reject(new Error(`Audio extraction failed: ${err.message}`));
      })
      .on('end', () => {
        outputStream.end();
      })
      .pipe(outputStream, { end: false });
  });
 } catch (error) {
  throw new Error(error)
 }
};

module.exports = {
  extractAudio,
};

