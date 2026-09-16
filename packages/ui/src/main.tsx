import './polyfills.js';

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.js';
import './styles.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('AEQUIRA application root was not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
