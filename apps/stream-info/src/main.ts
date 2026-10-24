import { initDock } from './render';
import './styles.css';

document.documentElement.lang = 'ru';
document.title = 'Stream Info';

const host = document.querySelector('#app');
if (!(host instanceof Element)) throw new Error('Не найден контейнер приложения.');
initDock(host);
