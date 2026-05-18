const { env } = require('./env');

/** Central place for static test inputs and edge cases */
const login = {
  valid: {
    username: env.validUsername,
    password: env.validPassword,
  },
  invalidPassword: {
    username: env.validUsername,
    password: 'wrong-password',
  },
  invalidUser: {
    username: 'unknown-user',
    password: 'any-password',
  },
  empty: {
    username: '',
    password: '',
  },
};

const navigation = {
  reportsHeading: 'Reports',
  settingsHeading: 'Settings',
};

module.exports = { login, navigation };
