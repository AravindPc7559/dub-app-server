const express = require('express');
const router = express.Router();
const indexController = require('../controllers/indexController');
const authRoutes = require('./auth');
const userRoutes = require('./userRoutes');
const videoRoutes = require('./videoRoutes');

router.get('/', indexController.getHome);
router.get('/health', indexController.getHealth);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/upload-video', videoRoutes);

module.exports = router;

