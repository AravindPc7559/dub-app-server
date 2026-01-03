const { ALLOWED_EMOTIONS } = require('../const/emotions');

/**
 * Validate and normalize emotion value
 * @param {string|null|undefined} emotion - Emotion value from GPT
 * @returns {string|null} Valid emotion or null
 */
const validateEmotion = (emotion) => {
  if (!emotion || typeof emotion !== 'string') {
    return null;
  }
  const normalizedEmotion = emotion.toLowerCase().trim();
  return ALLOWED_EMOTIONS.includes(normalizedEmotion) ? normalizedEmotion : null;
};

/**
 * Fix common JSON issues in GPT responses
 * @param {string} jsonString - Potentially malformed JSON string
 * @returns {string} Fixed JSON string
 */
const fixJSON = (jsonString) => {
  let fixed = jsonString;
  
  // Fix missing commas after string values (most common issue)
  // Pattern: "text": "value"\n    "emotion" -> "text": "value",\n    "emotion"
  // This handles cases like: "text": "..."\n    "emotion"
  // Use non-greedy match and handle escaped quotes
  fixed = fixed.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*"([^"]+)":/g, '"$1": "$2",\n    "$3":');
  
  // Fix missing commas after number values
  // Pattern: "start": 5.04\n    "end" -> "start": 5.04,\n    "end"
  fixed = fixed.replace(/"([^"]+)":\s*([0-9.]+)\s*\n\s*"([^"]+)":/g, '"$1": $2,\n    "$3":');
  
  // Fix missing commas after boolean/null values
  fixed = fixed.replace(/"([^"]+)":\s*(true|false|null)\s*\n\s*"([^"]+)":/g, '"$1": $2,\n    "$3":');
  
  // Fix missing commas after closing braces before another property
  // Pattern: }\n    "key" -> },\n    "key"
  fixed = fixed.replace(/}\s*\n\s*"([^"]+)":/g, '},\n    "$1":');
  
  // Fix missing commas between objects in array
  // Pattern: }\n    { -> },\n    {
  fixed = fixed.replace(/}\s*\n\s*\{/g, '},\n    {');
  
  // Fix trailing commas before closing brackets/braces (remove them)
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  return fixed;
};

/**
 * Parse and extract segments array from GPT response
 * @param {string} content - Raw content from GPT response
 * @returns {Array} Parsed segments array
 */
const parseGPTResponse = (content) => {
  // Remove markdown code blocks if present
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '');
    content = content.replace(/\s*```$/g, '');
  }

  // Try to parse as JSON
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseError) {
    // If initial parse fails, try to fix common JSON issues
    console.warn('Initial JSON parse failed, attempting to fix common issues...');
    console.error('JSON parse error at position:', parseError.message);
    console.error('Content preview:', content.substring(0, 500));
    
    try {
      const fixedContent = fixJSON(content);
      parsed = JSON.parse(fixedContent);
      console.log('✅ Successfully fixed and parsed JSON');
    } catch (fixError) {
      // If fixing also fails, log more details and throw
      console.error('Failed to fix JSON. Error:', fixError.message);
      console.error('Content (first 1000 chars):', content.substring(0, 1000));
      throw new Error(`Failed to parse translation response: ${parseError.message}. Fix attempt also failed: ${fixError.message}`);
    }
  }

  // Extract segments array
  let segmentsArray = null;
  
  // If it's wrapped in an object, extract the array
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    // Check for common keys that might contain the array
    const possibleKeys = ['segments', 'result', 'data', 'output', 'translation'];
    for (const key of possibleKeys) {
      if (Array.isArray(parsed[key])) {
        segmentsArray = parsed[key];
        break;
      }
    }
    // If no array found, return the object values as array
    if (!segmentsArray) {
      segmentsArray = Object.values(parsed).find(Array.isArray) || parsed;
    }
  } else {
    segmentsArray = parsed;
  }

  return segmentsArray;
};

/**
 * Validate and normalize segments with emotion validation
 * @param {Array} segmentsArray - Array of segments from GPT
 * @returns {Array} Validated and normalized segments
 */
const validateSegments = (segmentsArray) => {
  if (!Array.isArray(segmentsArray)) {
    return segmentsArray;
  }

  return segmentsArray.map(segment => {
    // Ensure segment has required fields
    if (!segment || typeof segment !== 'object') {
      return segment;
    }

    // Validate emotion field
    const validatedEmotion = validateEmotion(segment.emotion);
    
    return {
      start: segment.start,
      end: segment.end,
      text: segment.text,
      emotion: validatedEmotion
    };
  });
};

/**
 * Generate translation prompt for GPT
 * @param {Object} params - Prompt parameters
 * @param {Array} params.segments - Array of transcription segments
 * @param {string} params.videoLanguage - Source language name (e.g., "English", "Malayalam")
 * @param {string} params.targetLanguage - Target language name (e.g., "Malayalam", "Hindi")
 * @param {boolean} params.isTranslationNeeded - Whether translation is needed
 * @returns {string} Generated prompt string
 */
const generateTranslationPrompt = ({
  segments,
  videoLanguage,
  targetLanguage,
  isTranslationNeeded
}) => {
  return `
You are a professional Global Dubbing Engineer.

Your task is to adapt spoken content into a target language while strictly adhering to a physical timebox AND to classify the speaking emotion of each segment.

━━━━━━━━━━━━━━━━━━━━━━
1. CHANNEL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━
- Source Language: ${videoLanguage}
- Target Language: ${targetLanguage}
- Objective: ${isTranslationNeeded ? 'Translate and Time-Sync' : 'Rewrite for timing'}

━━━━━━━━━━━━━━━━━━━━━━
2. DURATION CONSTRAINT (STRICT)
━━━━━━━━━━━━━━━━━━━━━━
For every segment:
- Target Duration = (end - start) seconds.
- The rewritten text must be naturally speakable by a native ${targetLanguage} speaker within this duration.
- The speech must start at "start" and finish before "end".
- No overflow, no rushing, no silence padding.

━━━━━━━━━━━━━━━━━━━━━━
3. CHARACTER LENGTH CONSTRAINT (STRICT)
━━━━━━━━━━━━━━━━━━━━━━
For every segment:
- The translated/rewritten text MUST have the EXACT SAME character count as the original segment.text.
- Count includes spaces, punctuation, and all characters.
- Example: If original text has 30 characters, translated text must have exactly 30 characters.
- This is MANDATORY - character count must match exactly.

━━━━━━━━━━━━━━━━━━━━━━
4. ADAPTATION STRATEGY
━━━━━━━━━━━━━━━━━━━━━━
- For wordy languages (Hindi, Spanish, German): be concise.
- For dense languages (English, Chinese): expand slightly if needed.
- Output must sound natural and spoken, not literal or robotic.

━━━━━━━━━━━━━━━━━━━━━━
5. EMOTION CLASSIFICATION (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━
For EACH segment, classify the dominant speaking emotion based on the meaning of the sentence.

Choose ONLY ONE emotion from:
neutral, serious, happy, sad, angry, excited, calm

Rules:
- Base emotion on sentence meaning, not punctuation alone.
- Informational, instructional, or important statements → serious.
- High enthusiasm or surprise → excited.
- Peaceful or reassuring tone → calm.
- If no clear emotion → neutral.

━━━━━━━━━━━━━━━━━━━━━━
6. DATA MAPPING RULES
━━━━━━━━━━━━━━━━━━━━━━
- Preserve the exact "start" and "end" float values.
- Modify ONLY "text".
- Add a new field "emotion".

━━━━━━━━━━━━━━━━━━━━━━
7. OUTPUT RULES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━
- Output ONLY valid JSON.
- No markdown.
- No explanations.
- No extra fields.
- Format:
[
  {
    "start": number,
    "end": number,
    "text": "string",
    "emotion": "string"
  }
]

━━━━━━━━━━━━━━━━━━━━━━
INPUT SEGMENTS
━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(segments, null, 2)}
`;
};

module.exports = {
  validateEmotion,
  fixJSON,
  parseGPTResponse,
  validateSegments,
  generateTranslationPrompt,
};

