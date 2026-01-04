const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const videoController = require('../controllers/videoController');

router.post('/', authenticate, uploadMiddleware.single('video'), videoController.uploadVideo);
router.get('/videos/:userId', authenticate, videoController.getVideos)
router.get('/subtitles/:videoId', authenticate, videoController.getSubtitles)
router.get('/audio/:videoId', authenticate, videoController.downloadAudio)
router.get('/video/:videoId', authenticate, videoController.downloadVideo)
router.post('/:videoId/retry', authenticate, videoController.retryVideo)
router.delete('/:videoId', authenticate, videoController.deleteVideo)

module.exports = router;