const { buildSSML, generateAzureTTSBuffer } = require("../utils/azureUtils");
const { getAzureVoice } = require("../const/azureVoices");

const extractLocaleFromVoice = (voiceName) => {
  if (!voiceName || typeof voiceName !== 'string') {
    return null;
  }
  
  // Azure voice format: {language}-{region}-{name}Neural
  // Example: ja-JP-MayuNeural -> ja-JP
  const parts = voiceName.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return null;
};

const isAzureVoiceName = (voice) => {
  if (!voice || typeof voice !== 'string') {
    return false;
  }
  // Azure voices typically follow pattern: {lang}-{region}-{name}Neural
  return voice.includes('-') && (voice.endsWith('Neural') || voice.match(/^[a-z]{2}-[A-Z]{2}-/i));
};

const generateTTSBuffer = async ({
  text,
  voice,
  emotion = 'neutral',
  targetLanguage = 'en'
}) => {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text cannot be empty for TTS generation');
  }

  let azureVoice;
  let language;

  if (voice && isAzureVoiceName(voice)) {
    azureVoice = voice;
    language = extractLocaleFromVoice(voice) || getAzureVoice(targetLanguage).locale;
    console.log(`Using provided Azure voice: ${azureVoice} with locale: ${language}`);
  } else {
    const voiceConfig = getAzureVoice(targetLanguage);
    azureVoice = voiceConfig.voice;
    language = voiceConfig.locale;
    if (voice) {
      console.log(`Voice "${voice}" is not a valid Azure voice name, using language-based voice: ${azureVoice} for ${targetLanguage}`);
    } else {
      console.log(`No voice specified, using language-based voice: ${azureVoice} for ${targetLanguage}`);
    }
  }

  try {
    const ssml = buildSSML({
      text,
      emotion,
      language,
      voice: azureVoice
    });

    return await generateAzureTTSBuffer({ ssml });
  } catch (error) {
    if (error.message && error.message.includes('too small') && emotion !== 'neutral') {
      console.warn(`TTS failed with emotion "${emotion}", retrying with neutral emotion...`);
      const ssml = buildSSML({
        text,
        emotion: 'neutral',
        language,
        voice: azureVoice
      });
      return await generateAzureTTSBuffer({ ssml });
    }
    throw error;
  }
};

module.exports = {
  generateTTSBuffer,
};