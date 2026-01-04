const crypto = require('crypto');

// Simple in-memory cache for translations
// In production, consider using Redis for distributed caching
const translationCache = new Map();
const MAX_CACHE_SIZE = 1000;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const generateCacheKey = (text, sourceLang, targetLang) => {
  const hash = crypto.createHash('md5').update(`${text}|${sourceLang}|${targetLang}`).digest('hex');
  return hash;
};

const getCachedTranslation = (text, sourceLang, targetLang) => {
  const key = generateCacheKey(text, sourceLang, targetLang);
  const cached = translationCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  if (cached) {
    translationCache.delete(key);
  }
  
  return null;
};

const setCachedTranslation = (text, sourceLang, targetLang, translatedData) => {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (simple FIFO)
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
  
  const key = generateCacheKey(text, sourceLang, targetLang);
  translationCache.set(key, {
    data: translatedData,
    timestamp: Date.now()
  });
};

const clearCache = () => {
  translationCache.clear();
};

module.exports = {
  getCachedTranslation,
  setCachedTranslation,
  clearCache
};

