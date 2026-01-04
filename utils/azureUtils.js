const sdk = require("microsoft-cognitiveservices-speech-sdk");
const fs = require("fs");
const path = require("path");
const { EMOTION_MAP } = require("../const/emotions");

function buildSSML({ text, emotion, language = "hi-IN", voice, duration }) {
  const config = EMOTION_MAP[emotion] || EMOTION_MAP.neutral;
  
  // Escape XML special characters in text
  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // DO NOT use duration tag - it causes unnatural slowdown
  // Instead, rely on natural text length and break tags
  
  // Keep prosody values subtle and natural - emotions are already mapped with realistic values
  const naturalRate = config.rate;
  const naturalPitch = config.pitch;

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${language}">
  <voice name="${voice}">
    <mstts:express-as style="${config.style}">
      <prosody rate="${naturalRate}" pitch="${naturalPitch}">
        ${escapedText}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>`;
}

function generateAzureTTSBuffer({ ssml }) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(__dirname, '../tmp', `azure_tts_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`);
    
    // Ensure tmp directory exists
    const tmpDir = path.dirname(tempFile);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION
    );

    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Riff44100Hz16BitStereoPcm;

    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(tempFile);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    // Log SSML for debugging (first 200 chars)
    console.log(`Azure TTS SSML (preview): ${ssml.substring(0, 200)}...`);

    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        // Check if synthesis was successful FIRST
        if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
          synthesizer.close();
          const errorMsg = result.errorDetails || result.reason || 'Speech synthesis failed';
          console.error('Azure TTS synthesis failed:', errorMsg);
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          return reject(new Error(`Azure TTS synthesis failed: ${errorMsg}`));
        }

        // Try to get audio data directly from result first (most reliable)
        if (result.audioData && result.audioData.byteLength > 0) {
          synthesizer.close();
          const buffer = Buffer.from(result.audioData);
          
          // Validate WAV header
          if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            return reject(new Error(`Azure TTS generated invalid WAV (missing RIFF header). Size: ${buffer.length} bytes`));
          }
          
          // Check if it's just a header (44 bytes is typical WAV header size)
          if (buffer.length <= 44) {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            console.error(`Azure TTS returned only header (${buffer.length} bytes). SSML preview: ${ssml.substring(0, 200)}`);
            return reject(new Error(`Azure TTS generated empty audio (only header: ${buffer.length} bytes). This may indicate invalid SSML, unsupported voice style, or empty text.`));
          }
          
          if (buffer.length < 1000) {
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            console.error(`Azure TTS returned very small audio (${buffer.length} bytes). SSML preview: ${ssml.substring(0, 200)}`);
            return reject(new Error(`Azure TTS audio too small: ${buffer.length} bytes`));
          }
          
          // Clean up temp file if it exists
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          
          return resolve(buffer);
        }

        // Fallback: read from file with retry mechanism
        synthesizer.close();
        
        const maxRetries = 20; // Increased retries
        const retryDelay = 200; // Increased delay to 200ms
        let retries = 0;
        
        const checkAndReadFile = () => {
          try {
            // Check if file exists
            if (!fs.existsSync(tempFile)) {
              if (retries < maxRetries) {
                retries++;
                setTimeout(checkAndReadFile, retryDelay);
                return;
              }
              return reject(new Error('Azure TTS output file was not created after retries'));
            }

            const stats = fs.statSync(tempFile);
            
            // Check file size - should be at least 1KB for valid audio
            if (stats.size < 1000) {
              if (retries < maxRetries) {
                retries++;
                setTimeout(checkAndReadFile, retryDelay);
                return;
              }
              if (fs.existsSync(tempFile)) {
                const fileContent = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile);
                console.error(`Invalid file content (first 50 bytes): ${fileContent.slice(0, 50).toString('hex')}`);
              }
              return reject(new Error(`Azure TTS generated invalid audio file (size: ${stats.size} bytes)`));
            }

            // Read the file as buffer
            const buffer = fs.readFileSync(tempFile);
            
            // Validate buffer is not empty
            if (!buffer || buffer.length === 0) {
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
              return reject(new Error('Azure TTS generated empty audio buffer'));
            }

            // Validate WAV header (should start with "RIFF")
            if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
              if (fs.existsSync(tempFile)) {
                const firstBytes = buffer.slice(0, 50).toString('hex');
                console.error(`Invalid WAV header. First 50 bytes (hex): ${firstBytes}`);
                fs.unlinkSync(tempFile);
              }
              return reject(new Error(`Azure TTS generated invalid WAV file (missing RIFF header). File size: ${stats.size} bytes, Buffer size: ${buffer.length} bytes`));
            }

            // Verify file size matches buffer size
            if (buffer.length !== stats.size) {
              if (retries < maxRetries) {
                retries++;
                setTimeout(checkAndReadFile, retryDelay);
                return;
              }
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
              return reject(new Error(`File size mismatch: buffer ${buffer.length} vs file ${stats.size}`));
            }

            // Clean up temp file
            fs.unlinkSync(tempFile);
            resolve(buffer);
          } catch (readError) {
            if (retries < maxRetries) {
              retries++;
              setTimeout(checkAndReadFile, retryDelay);
              return;
            }
            // Clean up temp file even if read fails
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
            reject(new Error(`Failed to read generated audio file after retries: ${readError.message}`));
          }
        };

        // Start checking after a small initial delay
        setTimeout(checkAndReadFile, 100);
      },
      (err) => {
        synthesizer.close();
        // Clean up temp file on error
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        console.error('Azure TTS error:', err);
        reject(new Error(`Azure TTS error: ${err.message || err}`));
      }
    );
  });
}

module.exports = {
  buildSSML,
  generateAzureTTSBuffer
};