export function getLoginValidationError({ email, password }) {
  if (!email || !password.trim()) {
    return 'Please enter both email and password.';
  }
  return null;
}

export function getSignupValidationError({ name, email, password }) {
  if (!name || !email || !password) {
    return 'Please fill in name, email, and password.';
  }
  return null;
}

export function loginSuccessMessage(user) {
  return `Welcome${user?.name ? `, ${user.name}` : ''}.`;
}

export function signupSuccessMessage(user) {
  return `Account created${user?.name ? ` for ${user.name}` : ''}.`;
}
