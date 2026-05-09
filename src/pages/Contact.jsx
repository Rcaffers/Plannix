import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { submitContactForm } from '../utils/api';
import './Contact.css';

export default function Contact({ user }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user?.id, user?.name, user?.email]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setStatus('sending');
    try {
      await submitContactForm({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      });
      setStatus('sent');
      setMessage('');
    } catch (err) {
      setStatus('idle');
      setError(err.message || 'Something went wrong.');
    }
  }

  const isSending = status === 'sending';

  return (
    <main className="contact-page">
      <div className="container contact-inner">
        <p className="contact-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Contact
        </p>
        <header className="contact-header">
          <p className="contact-kicker">Get in touch</p>
          <h1 className="contact-title">Contact us</h1>
          <p className="contact-lead">
            Questions about Plannix, plans, or your account? Send a message and we will get back to you.
          </p>
        </header>

        {status === 'sent' ? (
          <div className="contact-success" role="status">
            <p className="contact-success-title">Message sent</p>
            <p className="contact-success-body">Thanks for reaching out. We will reply as soon as we can.</p>
            <button
              type="button"
              className="contact-send-another"
              onClick={() => {
                setStatus('idle');
                setError('');
              }}
            >
              Send another message
            </button>
          </div>
        ) : (
          <form className="contact-form" onSubmit={handleSubmit}>
            {user ? (
              <p className="contact-signed-in-note">
                You are signed in — name and email below are from your account and match what we will include with your
                message.
              </p>
            ) : null}

            <div className="contact-field">
              <label htmlFor="contact-name">Name</label>
              <input
                id="contact-name"
                name="name"
                type="text"
                autoComplete="name"
                className={user ? 'contact-input-readonly' : undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={Boolean(user)}
                disabled={isSending}
                required
              />
            </div>

            <div className="contact-field">
              <label htmlFor="contact-email">Email</label>
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                className={user ? 'contact-input-readonly' : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={Boolean(user)}
                disabled={isSending}
                required
              />
            </div>

            <div className="contact-field">
              <label htmlFor="contact-message">Message</label>
              <textarea
                id="contact-message"
                name="message"
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isSending}
                required
                minLength={3}
              />
            </div>

            {error ? (
              <p className="contact-message contact-message--error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="contact-submit" disabled={isSending}>
              {isSending ? 'Sending…' : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
