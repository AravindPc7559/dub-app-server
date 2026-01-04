const OpenAI = require("openai");
const { parseGPTResponse, validateSegments, generateTranslationPrompt } = require("../utils/jsonUtils");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Simple in-memory cache for translations (can be upgraded to Redis)
const translationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const getCacheKey = (text, videoLanguage, targetLanguage) => {
  return `${videoLanguage}:${targetLanguage}:${text.toLowerCase().trim()}`;
};

const getCachedTranslation = (text, videoLanguage, targetLanguage) => {
  const key = getCacheKey(text, videoLanguage, targetLanguage);
  const cached = translationCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
};

const setCachedTranslation = (text, videoLanguage, targetLanguage, data) => {
  const key = getCacheKey(text, videoLanguage, targetLanguage);
  translationCache.set(key, {
    data,
    timestamp: Date.now()
  });
  // Limit cache size to prevent memory issues
  if (translationCache.size > 10000) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
};

const translateSegmentBatch = async ({
  segments,
  videoLanguage,
  targetLanguage,
  isTranslationNeeded,
  voice,
  targetLanguageCode
}) => {
  const prompt = generateTranslationPrompt({
    segments,
    videoLanguage,
    targetLanguage,
    isTranslationNeeded,
    voice,
    targetLanguageCode
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You are a professional translator and script writer for video dubbing. ${isTranslationNeeded ? `You translate from ${videoLanguage} to ${targetLanguage} and write natural, conversational scripts in ${targetLanguage}.` : `You rewrite scripts to make them natural and conversational.`} Always output ONLY a valid JSON array. Never use markdown code blocks. Output pure JSON only.`
      },
      { role: "user", content: prompt }
    ]
  });

  const content = response.choices[0].message.content.trim();
  const segmentsArray = parseGPTResponse(content);
  return validateSegments(segmentsArray);
};

const translateSegments = async ({
  segments,
  videoLanguage,
  targetLanguage,
  voice = null,
  targetLanguageCode = 'en'
}) => {
  const isTranslationNeeded = videoLanguage && targetLanguage &&
    videoLanguage.toLowerCase() !== targetLanguage.toLowerCase();

  const BATCH_SIZE = 8; // Process 8 segments per batch
  const CONCURRENT_BATCHES = 2; // Process 2 batches in parallel
  const results = [];
  const uncachedSegments = [];
  const uncachedIndices = [];

  // Check cache for each segment
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const cached = getCachedTranslation(segment.text, videoLanguage, targetLanguage);
    if (cached) {
      results[i] = { ...cached, start: segment.start, end: segment.end };
    } else {
      uncachedSegments.push(segment);
      uncachedIndices.push(i);
    }
  }

  // Process uncached segments in batches
  if (uncachedSegments.length > 0) {
    console.log(`[Translate] ${uncachedSegments.length}/${segments.length} segments need translation (${segments.length - uncachedSegments.length} cached)`);

    for (let i = 0; i < uncachedSegments.length; i += BATCH_SIZE * CONCURRENT_BATCHES) {
      const batchGroup = [];
      for (let j = 0; j < CONCURRENT_BATCHES && i + j * BATCH_SIZE < uncachedSegments.length; j++) {
        const batchStart = i + j * BATCH_SIZE;
        const batch = uncachedSegments.slice(batchStart, batchStart + BATCH_SIZE);
        const batchIndices = uncachedIndices.slice(batchStart, batchStart + BATCH_SIZE);
        if (batch.length > 0) {
          batchGroup.push({ batch, batchIndices });
        }
      }

      const batchResults = await Promise.allSettled(
        batchGroup.map(({ batch, batchIndices }) =>
          translateSegmentBatch({
            segments: batch,
            videoLanguage,
            targetLanguage,
            isTranslationNeeded,
            voice,
            targetLanguageCode
          }).then(translated => ({ translated, batchIndices }))
        )
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { translated, batchIndices } = result.value;
          translated.forEach((translatedSegment, idx) => {
            const originalIndex = batchIndices[idx];
            if (originalIndex !== undefined) {
              results[originalIndex] = translatedSegment;
              // Cache the translation
              const originalSegment = segments[originalIndex];
              if (originalSegment) {
                setCachedTranslation(originalSegment.text, videoLanguage, targetLanguage, translatedSegment);
              }
            }
          });
        } else {
          console.error('[Translate] Batch failed:', result.reason);
        }
      }
    }
  }

  // Ensure all segments are present and in correct order
  const finalResults = [];
  for (let i = 0; i < segments.length; i++) {
    if (results[i]) {
      finalResults.push(results[i]);
    } else {
      // Fallback: use original segment if translation failed
      console.warn(`[Translate] Missing translation for segment ${i}, using original`);
      finalResults.push(segments[i]);
    }
  }

  return finalResults;
};

const expandSegmentText = async ({
  segment,
  actualDuration,
  targetDuration,
  targetLanguage,
  targetLanguageCode,
  voice
}) => {
  const { getAzureVoice } = require('../const/azureVoices');
  const voiceConfig = voice ? { voice, locale: voice.split('-').slice(0, 2).join('-') } : getAzureVoice(targetLanguageCode);
  const azureVoiceName = voiceConfig.voice;
  const locale = voiceConfig.locale;
  
  const durationShortfall = targetDuration - actualDuration;
  const expansionRatio = targetDuration / actualDuration;
  
  const prompt = `You are a professional script writer for video dubbing.

TASK: Expand the following dialogue text to naturally fill ${targetDuration.toFixed(2)} seconds of speaking time.

CURRENT SITUATION:
- Current text: "${segment.text}"
- Current duration: ${actualDuration.toFixed(2)} seconds
- Target duration: ${targetDuration.toFixed(2)} seconds
- Need to add: ${durationShortfall.toFixed(2)} seconds (approximately ${Math.round((expansionRatio - 1) * 100)}% longer)

REQUIREMENTS:
1. Expand the text to be approximately ${Math.round(expansionRatio * 100)}% longer
2. Keep the SAME meaning and emotion
3. Make it sound natural and conversational
4. Add descriptive words, phrases, or slight elaborations
5. Maintain the same emotion: ${segment.emotion || 'neutral'}
6. Keep the same style and tone
7. Add natural pauses with <break time='Xms'/> tags where appropriate

EXAMPLES:
- "Hello" → "Hello there, <break time='100ms'/> how are you doing?"
- "I'm fine" → "I'm doing quite well, <break time='150ms'/> thank you for asking"
- "Let's go" → "Alright then, <break time='100ms'/> let's get going now"

OUTPUT FORMAT (JSON):
{
  "text": "expanded text here",
  "taggedText": "expanded text with <break time='Xms'/> tags at natural pauses",
  "ssml": "complete SSML with voice ${azureVoiceName}, locale ${locale}, emotion ${segment.emotion || 'neutral'}"
}

The SSML must be complete and ready to use. Include:
- <speak> tag with proper namespaces
- <voice name="${azureVoiceName}">
- DO NOT include <mstts:audioduration> tag - it causes unnatural slowdown
- <mstts:express-as style="${segment.emotion || 'neutral'}">
- The taggedText with break tags to naturally fill the duration
- Proper closing tags

Return ONLY valid JSON, no markdown.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: "You are a professional script writer. Always output ONLY valid JSON. Never use markdown code blocks."
      },
      { role: "user", content: prompt }
    ]
  });

  const content = response.choices[0].message.content.trim();
  let expandedData;
  
  try {
    const cleanContent = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '');
    expandedData = JSON.parse(cleanContent);
  } catch (error) {
    throw new Error(`Failed to parse expanded text response: ${error.message}`);
  }
  
  return {
    ...segment,
    text: expandedData.text || segment.text,
    taggedText: expandedData.taggedText || expandedData.text || segment.text,
    ssml: expandedData.ssml || segment.ssml
  };
};

module.exports = {
  translateSegments,
  expandSegmentText,
};
