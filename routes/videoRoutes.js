const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const videoController = require('../controllers/videoController');

router.post('/', authenticate, uploadMiddleware.single('video'), videoController.uploadVideo);

module.exports = router;