import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { createPlannixRouter } from './appRouter';
import './styles/base.css';
import './styles/accessibility.css';

const router = createPlannixRouter();

createRoot(document.getElementById('root')).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
