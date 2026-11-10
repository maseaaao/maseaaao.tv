import { mountAdmin } from './admin';
import { mountWidget } from './widget';
import './styles.css';

const path = window.location.pathname.toLowerCase();
const widget =
  path.endsWith('/widget.html') ||
  path.endsWith('/widget') ||
  new URLSearchParams(window.location.search).has('widget');
document.body.classList.add(widget ? 'mode-widget' : 'mode-admin');

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app');
}

if (widget) {
  mountWidget(root);
} else {
  mountAdmin(root);
}
