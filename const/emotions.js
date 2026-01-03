const ALLOWED_EMOTIONS = ['neutral', 'serious', 'happy', 'sad', 'angry', 'excited', 'calm'];

const EMOTION_MAP = {
  neutral:  { style: "general",  rate: "0%",  pitch: "0%" },
  serious:  { style: "serious",  rate: "-3%", pitch: "-3%" },
  happy:    { style: "cheerful", rate: "+10%", pitch: "+8%" },
  excited:  { style: "excited",  rate: "+12%", pitch: "+10%" },
  calm:     { style: "calm",     rate: "-5%", pitch: "-2%" },
  sad:      { style: "sad",      rate: "-10%", pitch: "-6%" },
  angry:    { style: "angry",    rate: "+5%", pitch: "+12%" }
}

module.exports = {
  ALLOWED_EMOTIONS,
  EMOTION_MAP,
};

