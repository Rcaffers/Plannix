import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dispatchOpenPrivacyModal } from '../utils/plannixEvents';

/** Opens the privacy notice modal then replaces history so /privacy works as a shareable entry point. */
export default function PrivacyGate() {
  const navigate = useNavigate();

  useEffect(() => {
    dispatchOpenPrivacyModal();
    navigate('/', { replace: true });
  }, [navigate]);

  return null;
}
