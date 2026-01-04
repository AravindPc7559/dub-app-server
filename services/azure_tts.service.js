const { buildSSML, generateAzureTTSBuffer } = require("../utils/azureUtils");
const { getAzureVoice } = require("../const/azureVoices");

const extractLocaleFromVoice = (voiceName) => {
  if (!voiceName || typeof voiceName !== 'string') return null;
  const parts = voiceName.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return null;
};

const isAzureVoiceName = (voice) => {
  if (!voice || typeof voice !== 'string') return false;
  return voice.includes('-') && (voice.endsWith('Neural') || voice.match(/^[a-z]{2}-[A-Z]{2}-/i));
};

const generateTTSBuffer = async ({
  text,
  voice,
  emotion = 'neutral',
  targetLanguage = 'en',
  duration,
  ssml: providedSSML = null
}) => {
  if (providedSSML && typeof providedSSML === 'string' && providedSSML.trim().length > 0) {
    try {
      return await generateAzureTTSBuffer({ ssml: providedSSML });
    } catch (error) {
      // Fallback to building SSML from text
    }
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text cannot be empty for TTS generation');
  }

  let azureVoice;
  let language;

  if (voice && isAzureVoiceName(voice)) {
    azureVoice = voice;
    language = extractLocaleFromVoice(voice) || getAzureVoice(targetLanguage).locale;
  } else {
    const voiceConfig = getAzureVoice(targetLanguage);
    azureVoice = voiceConfig.voice;
    language = voiceConfig.locale;
  }

  try {
    const ssml = buildSSML({ text, emotion, language, voice: azureVoice, duration });
    return await generateAzureTTSBuffer({ ssml });
  } catch (error) {
    if (error.message && error.message.includes('too small') && emotion !== 'neutral') {
      const ssml = buildSSML({ text, emotion: 'neutral', language, voice: azureVoice });
      return await generateAzureTTSBuffer({ ssml });
    }
    throw error;
  }
};

module.exports = {
  generateTTSBuffer,
};