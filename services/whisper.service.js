const fs = require('fs');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Transcribe audio using Whisper
 * @param {string} audioPath - Path to audio file (vocals.mp3)
 * @param {string|null} language - Optional language code (e.g. 'en', 'hi', 'ml'). 
 *                                  If supported, uses language parameter. If not supported, auto-detects.
 * @returns {Promise<Object>} Transcription response with text, language, segments, etc.
 */
const transcribeAudio = async (audioPath, language = null) => {
  const requestOptions = {
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    temperature: 0,
    language: 'en'
  };

  const response = await openai.audio.transcriptions.create(requestOptions);

  return response;
};

module.exports = {
  transcribeAudio,
};
