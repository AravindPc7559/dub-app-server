const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const userController = require('../controllers/userController');

router.get('/profile', authenticate, userController.getProfile);


module.exports = router;

