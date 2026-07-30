import './polyfills.js';

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
