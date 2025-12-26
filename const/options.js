const options = {
    videoStatus: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    jobStatus: ['PENDING', 'RUNNING', 'DONE', 'FAILED'],
    jobStep: ['EXTRACT_AUDIO', 'TRANSCRIBE', 'TRANSLATE', 'GENERATE_VOICE', 'MERGE', 'FINALIZE']
}

module.exports = options;