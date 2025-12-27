const { SUPPORTED_LANGUAGES, LANGUAGE_MAP, LANGUAGE_TO_SCRIPT } = require("../const/openAiLanguages");

/**
 * Check if a language code is supported by Whisper
 * @param {string|null} language - Language code to check
 * @returns {boolean} True if supported, false otherwise
 */
const isLanguageSupported = (language) => {
  if (!language) return false;
  return SUPPORTED_LANGUAGES.includes(language.toLowerCase());
};

/**
 * Normalize transcription segments
 * @param {Array} segments - Array of segment objects from Whisper
 * @returns {Array} Normalized segments with cleaned start, end, and text
 */
const normalizeSegments = (segments) => {
  if (!segments || !Array.isArray(segments)) {
    return [];
  }

  return segments
    .map(seg => {
      if (!seg || typeof seg !== 'object') return null;
      
      const start = Number(seg.start.toFixed(2));
      const end = Number(seg.end.toFixed(2));
      const text = seg.text ? seg.text.trim() : '';

      if (!text || end <= start) return null;

      return { start, end, text };
    })
    .filter(Boolean);
};


module.exports = {
  isLanguageSupported,
  normalizeSegments,
};
  