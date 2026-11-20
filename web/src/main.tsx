import { render } from 'preact';
import { App } from './App';
import './styles.css';
import { registerServiceWorker } from './sw-register';

render(<App />, document.getElementById('app')!);
registerServiceWorker();
