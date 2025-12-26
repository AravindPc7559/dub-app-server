const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { sendSuccess, sendError } = require('../utils/response');
const { generateToken } = require('../utils/jwt');
const { validateEmail, validateRequired } = require('../utils/validators');

const authController = {
  register: async (req, res) => {
    try {
      const { email, password, name, socialMediaAccountName } = req.body;

      if (!validateRequired(email) || !validateRequired(password)) {
        return sendError(res, 'Email and password are required', 400);
      }

      if (!validateEmail(email)) {
        return sendError(res, 'Invalid email format', 400);
      }

      if (password.length < 6) {
        return sendError(res, 'Password must be at least 6 characters', 400);
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return sendError(res, 'User already exists with this email', 409);
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await User.create({
        email,
        passwordHash,
        name,
        socialMediaAccountName,
        authProvider: 'local',
        plan: 'CREATOR',
        monthlyLimit: 15,
        reelsUsedThisMonth: 3,
      });

      const token = generateToken(user._id);

      return sendSuccess(
        res,
        'User registered successfully',
        {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            socialMediaAccountName: user.socialMediaAccountName,
            plan: user.plan,
            monthlyLimit: user.monthlyLimit,
            reelsUsedThisMonth: user.reelsUsedThisMonth,
          },
        },
        201
      );
    } catch (error) {
      return sendError(res, error.message, 500);
    }
  },

  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!validateRequired(email) || !validateRequired(password)) {
        return sendError(res, 'Email and password are required', 400);
      }

      const user = await User.findOne({ email });
      if (!user) {
        return sendError(res, 'Invalid email or password', 401);
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        return sendError(res, 'Invalid email or password', 401);
      }

      const token = generateToken(user._id);

      return sendSuccess(
        res,
        'Login successful',
        {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            socialMediaAccountName: user.socialMediaAccountName,
            plan: user.plan,
            monthlyLimit: user.monthlyLimit,
            reelsUsedThisMonth: user.reelsUsedThisMonth,
          },
        }
      );
    } catch (error) {
      return sendError(res, error.message, 500);
    }
  },
};

module.exports = authController;
