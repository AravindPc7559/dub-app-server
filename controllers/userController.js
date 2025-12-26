const { sendSuccess } = require('../utils/response');

const userController = {
  getProfile: (req, res) => {
    return sendSuccess(
      res,
      'User profile retrieved successfully',
      {
        user: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          socialMediaAccountName: req.user.socialMediaAccountName,
          plan: req.user.plan,
          monthlyLimit: req.user.monthlyLimit,
          reelsUsedThisMonth: req.user.reelsUsedThisMonth,
        },
      }
    );
  },
};

module.exports = userController;

