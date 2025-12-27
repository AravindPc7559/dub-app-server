const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve demucs binary path from server directory
const DEMUCS_BIN = path.resolve(
  __dirname,
  '../tools/demucs-env/bin/demucs'
);

/**
 * Run Demucs to separate vocals and background from audio
 * @param {string} inputAudioPath - Path to input audio file
 * @param {string} outputDir - Directory to save output files
 * @returns {Promise<{vocalsPath: string, backgroundPath: string}>}
 */
const runDemucs = (inputAudioPath, outputDir) => {
  return new Promise((resolve, reject) => {
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    const demucs = spawn(DEMUCS_BIN, [
      '--two-stems=vocals',
      '--mp3',
      '-o',
      outputDir,
      inputAudioPath
    ]);

    demucs.stdout.on('data', data => {
      console.log(`[demucs]: ${data}`);
    });

    demucs.stderr.on('data', data => {
      console.error(`[demucs error]: ${data}`);
    });

    demucs.on('close', code => {
      if (code !== 0) {
        return reject(new Error('Demucs process failed'));
      }

      // Resolve output paths
      const baseName = path.basename(
        inputAudioPath,
        path.extname(inputAudioPath)
      );

      const resultDir = path.join(
        outputDir,
        'htdemucs',
        baseName
      );

      resolve({
        vocalsPath: path.join(resultDir, 'vocals.mp3'),
        backgroundPath: path.join(resultDir, 'no_vocals.mp3')
      });
    });
  });
};

module.exports = {
  runDemucs,
};
