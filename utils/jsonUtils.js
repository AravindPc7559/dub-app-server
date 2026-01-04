const { ALLOWED_EMOTIONS } = require('../const/emotions');

const validateEmotion = (emotion) => {
  if (!emotion || typeof emotion !== 'string') return null;
  const normalizedEmotion = emotion.toLowerCase().trim();
  return ALLOWED_EMOTIONS.includes(normalizedEmotion) ? normalizedEmotion : null;
};

const fixJSON = (jsonString) => {
  let fixed = jsonString;
  fixed = fixed.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*"([^"]+)":/g, '"$1": "$2",\n    "$3":');
  fixed = fixed.replace(/"([^"]+)":\s*([0-9.]+)\s*\n\s*"([^"]+)":/g, '"$1": $2,\n    "$3":');
  fixed = fixed.replace(/"([^"]+)":\s*(true|false|null)\s*\n\s*"([^"]+)":/g, '"$1": $2,\n    "$3":');
  fixed = fixed.replace(/}\s*\n\s*"([^"]+)":/g, '},\n    "$1":');
  fixed = fixed.replace(/}\s*\n\s*\{/g, '},\n    {');
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  return fixed;
};

const parseGPTResponse = (content) => {
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '');
    content = content.replace(/\s*```$/g, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseError) {
    try {
      const fixedContent = fixJSON(content);
      parsed = JSON.parse(fixedContent);
    } catch (fixError) {
      console.error('[GPT] Failed to parse response:', fixError.message);
      throw new Error(`Failed to parse translation response: ${parseError.message}`);
    }
  }

  let segmentsArray = null;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const possibleKeys = ['segments', 'result', 'data', 'output', 'translation'];
    for (const key of possibleKeys) {
      if (Array.isArray(parsed[key])) {
        segmentsArray = parsed[key];
        break;
      }
    }
    if (!segmentsArray) {
      segmentsArray = Object.values(parsed).find(Array.isArray) || parsed;
    }
  } else {
    segmentsArray = parsed;
  }

  return segmentsArray;
};

const validateSegments = (segmentsArray) => {
  if (!Array.isArray(segmentsArray)) return segmentsArray;

  return segmentsArray.map(segment => {
    if (!segment || typeof segment !== 'object') return segment;

    const validatedEmotion = validateEmotion(segment.emotion);
    const ssml = segment.ssml || '';
    
    return {
      start: segment.start,
      end: segment.end,
      text: segment.text,
      emotion: validatedEmotion,
      styleDegree: typeof segment.styleDegree === 'number' ? Math.max(0, Math.min(1, segment.styleDegree)) : 0.5,
      taggedText: segment.taggedText || segment.text || '',
      ssml: ssml
    };
  });
};

const generateTranslationPrompt = ({
  segments,
  videoLanguage,
  targetLanguage,
  isTranslationNeeded,
  voice = null,
  targetLanguageCode = 'en'
}) => {
  const { getAzureVoice } = require('../const/azureVoices');
  const voiceConfig = voice ? { voice, locale: voice.split('-').slice(0, 2).join('-') } : getAzureVoice(targetLanguageCode);
  const azureVoiceName = voiceConfig.voice;
  const locale = voiceConfig.locale;
  
  return `You are a professional dubbing engineer. ${isTranslationNeeded ? `Translate from ${videoLanguage} to ${targetLanguage}` : 'Rewrite for natural speech'} while maintaining timing and emotion.

CONFIG: ${targetLanguage} (${targetLanguageCode}), Voice: ${azureVoiceName}, Locale: ${locale}

RULES:
1. Duration: Text must fit within (end - start) seconds. Natural pace, no rushing.
2. Character count: Translated text must match original character count exactly.
3. Emotion: Detect emotion (cheerful, sad, neutral, happy, angry, excited, calm, serious, determined) and intensity (0.0-1.0).
4. Pauses: Add <break time='100-500ms'/> tags at natural pauses (commas, periods).
5. SSML: Generate complete SSML with:
   <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">
     <voice name="${azureVoiceName}>
       <mstts:express-as style="[emotion]">
         [text with break tags]
       </mstts:express-as>
     </voice>
   </speak>
   - Use exact voice: "${azureVoiceName}"
   - Use exact locale: "${locale}"
   - DO NOT include <mstts:audioduration> tag

OUTPUT: JSON array only, no markdown. Each object: {start, end, text, emotion, styleDegree, taggedText, ssml}

INPUT SEGMENTS:
${JSON.stringify(segments, null, 2)}`;
};

module.exports = {
  validateEmotion,
  fixJSON,
  parseGPTResponse,
  validateSegments,
  generateTranslationPrompt,
};

