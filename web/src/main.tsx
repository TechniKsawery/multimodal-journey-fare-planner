import { render } from 'preact';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';
import { registerServiceWorker } from './sw-register';

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('app')!);
registerServiceWorker();
