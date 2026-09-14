export function getLoginValidationError({ email, password }) {
  if (!email || !password.trim()) {
    return 'Please enter both email and password.';
  }
  return null;
}

export function signupSubmission({ firstName, lastName, email, password }) {
  return {
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    email: String(email || '').trim(),
    password: String(password || ''),
  };
}

export function getSignupValidationError({ firstName, lastName, email, password }) {
  if (!firstName || !lastName || !email || !password) {
    return 'Please fill in first name, last name, email, and password.';
  }
  return null;
}

export function loginSuccessMessage(user) {
  return `Welcome${user?.name ? `, ${user.name}` : ''}.`;
}

export function signupSuccessMessage(user) {
  return `Account created${user?.name ? ` for ${user.name}` : ''}.`;
}

export function signupConfirmationMessage() {
  return 'Check your email and follow the confirmation link before logging in.';
}
