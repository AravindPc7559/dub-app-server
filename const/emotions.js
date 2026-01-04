const ALLOWED_EMOTIONS = ['neutral', 'serious', 'happy', 'sad', 'angry', 'excited', 'calm'];

const EMOTION_MAP = {
  neutral:  { style: "general",  rate: "0%",  pitch: "0%" },
  serious:  { style: "serious",  rate: "-2%", pitch: "-2%" },
  happy:    { style: "cheerful", rate: "+3%", pitch: "+3%" },
  excited:  { style: "excited",  rate: "+5%", pitch: "+4%" },
  calm:     { style: "calm",     rate: "-3%", pitch: "-1%" },
  sad:      { style: "sad",      rate: "-5%", pitch: "-3%" },
  angry:    { style: "angry",    rate: "+3%", pitch: "+5%" }
}

module.exports = {
  ALLOWED_EMOTIONS,
  EMOTION_MAP,
};

