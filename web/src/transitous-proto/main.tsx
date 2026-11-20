import { render } from "preact";
import { App } from "./App";
import "./style.css";
import { registerServiceWorker } from '../sw-register';

render(<App />, document.getElementById("app")!);
registerServiceWorker();
