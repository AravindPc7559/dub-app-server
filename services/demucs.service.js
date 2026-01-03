const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEMUCS_BIN = path.resolve(
  __dirname,
  '../tools/demucs-env/bin/demucs'
);

/**
 * Run Demucs to separate vocals and background from audio
 */
const runDemucs = (inputAudioPath, outputDir) => {
  return new Promise((resolve, reject) => {
    // 1. FIX: Check if file exists and has content before running Demucs
    if (!fs.existsSync(inputAudioPath)) {
      return reject(new Error(`Input file not found: ${inputAudioPath}`));
    }

    const stats = fs.statSync(inputAudioPath);
    // Files smaller than ~10KB are usually empty or just headers, 
    // which cause the 'degrees of freedom <= 0' error.
    if (stats.size < 10000) { 
      return reject(new Error('Audio file is too short or empty for separation.'));
    }

    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // 2. IMPROVEMENT: Added -n mdx_extra_q if you want better stability 
    // for shorter clips, otherwise keep default.
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
        return reject(new Error(`Demucs process failed with code ${code}`));
      }

      const baseName = path.basename(
        inputAudioPath,
        path.extname(inputAudioPath)
      );

      // Note: If you change the model with -n, this directory name might change.
      // htdemucs is the default folder name for the current version.
      const resultDir = path.join(
        outputDir,
        'htdemucs',
        baseName
      );

      const vocalsPath = path.join(resultDir, 'vocals.mp3');
      const backgroundPath = path.join(resultDir, 'no_vocals.mp3');

      // Double check the output actually exists before resolving
      if (fs.existsSync(vocalsPath)) {
        resolve({ vocalsPath, backgroundPath });
      } else {
        reject(new Error('Demucs finished but output files were not found.'));
      }
    });
  });
};

module.exports = {
  runDemucs,
};