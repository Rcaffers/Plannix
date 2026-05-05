import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dispatchOpenTermsModal } from '../utils/plannixEvents';

/** Opens the terms modal then replaces history so /terms works as a shareable entry point. */
export default function TermsGate() {
  const navigate = useNavigate();

  useEffect(() => {
    dispatchOpenTermsModal();
    navigate('/', { replace: true });
  }, [navigate]);

  return null;
}
