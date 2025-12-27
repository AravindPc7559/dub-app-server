const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate TTS audio from text
 * @param {string} text - Text to convert to speech
 * @param {string} outputPath - Path where to save the audio file
 * @param {string} voice - Voice to use (alloy, echo, fable, onyx, nova, shimmer)
 * @returns {Promise<string>} Path to the generated audio file
 */
const generateTTS = async ({
  text,
  outputPath,
  voice = "alloy"
}) => {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    format: "wav"
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
};

/**
 * Generate TTS audio from text and return as buffer
 * @param {string} text - Text to convert to speech
 * @param {string} voice - Voice to use (alloy, echo, fable, onyx, nova, shimmer)
 * @returns {Promise<Buffer>} Audio buffer
 */
const generateTTSBuffer = async ({
  text,
  voice = "alloy"
}) => {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    format: "wav"
  });

  return Buffer.from(await response.arrayBuffer());
};

module.exports = {
  generateTTS,
  generateTTSBuffer,
};