// Validation utility functions
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateRequired = (value) => {
  return value !== null && value !== undefined && value !== '';
};

const validateLength = (value, min, max) => {
  if (!value) return false;
  const length = value.toString().length;
  return length >= min && length <= max;
};

module.exports = {
  validateEmail,
  validateRequired,
  validateLength,
};

