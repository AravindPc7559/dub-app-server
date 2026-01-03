// Azure TTS voice mapping by language code
// Format: languageCode: { voice: "voice-name", locale: "locale-code" }
const AZURE_VOICE_MAP = {
  'en': { voice: 'en-US-JennyNeural', locale: 'en-US' },
  'hi': { voice: 'hi-IN-MadhurNeural', locale: 'hi-IN' },
  'es': { voice: 'es-ES-ElviraNeural', locale: 'es-ES' },
  'fr': { voice: 'fr-FR-DeniseNeural', locale: 'fr-FR' },
  'de': { voice: 'de-DE-KatjaNeural', locale: 'de-DE' },
  'it': { voice: 'it-IT-ElsaNeural', locale: 'it-IT' },
  'pt': { voice: 'pt-BR-FranciscaNeural', locale: 'pt-BR' },
  'ru': { voice: 'ru-RU-SvetlanaNeural', locale: 'ru-RU' },
  'ja': { voice: 'ja-JP-NanamiNeural', locale: 'ja-JP' },
  'ko': { voice: 'ko-KR-SunHiNeural', locale: 'ko-KR' },
  'zh': { voice: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN' },
  'ar': { voice: 'ar-SA-ZariyahNeural', locale: 'ar-SA' },
  'ml': { voice: 'ml-IN-MidhunNeural', locale: 'ml-IN' },
  'ta': { voice: 'ta-IN-PallaviNeural', locale: 'ta-IN' },
  'te': { voice: 'te-IN-MohanNeural', locale: 'te-IN' },
  'kn': { voice: 'kn-IN-GaganNeural', locale: 'kn-IN' },
  'mr': { voice: 'mr-IN-AarohiNeural', locale: 'mr-IN' },
  'gu': { voice: 'gu-IN-DhwaniNeural', locale: 'gu-IN' },
  'bn': { voice: 'bn-IN-BashkarNeural', locale: 'bn-IN' },
  'pa': { voice: 'pa-IN-GurpreetNeural', locale: 'pa-IN' },
  'ur': { voice: 'ur-PK-GulNeural', locale: 'ur-PK' },
};

/**
 * Get Azure voice configuration for a language code
 * @param {string} languageCode - Language code (e.g., 'en', 'hi', 'ml')
 * @returns {Object} Voice configuration with voice and locale, or default to English
 */
const getAzureVoice = (languageCode) => {
  if (!languageCode) {
    return AZURE_VOICE_MAP['en'];
  }
  const normalizedCode = languageCode.toLowerCase().split('-')[0]; // Get base language code
  return AZURE_VOICE_MAP[normalizedCode] || AZURE_VOICE_MAP['en'];
};

module.exports = {
  getAzureVoice,
};

