import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../../../dist/stream-info');
const files = readdirSync(dist).filter((name) => name.endsWith('.html'));
if (files.length !== 1 || files[0] !== 'change-info-streamer-bot.ru.html') {
  throw new Error('Expected exactly one Russian standalone HTML');
}
const html = readFileSync(resolve(dist, files[0]), 'utf8');
if (!/<html\s+lang="ru"/.test(html)) {
  throw new Error('Russian document language is missing');
}
for (const tag of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)) {
  if (!(tag[1]?.startsWith('data:') || tag[1]?.startsWith('#'))) {
    throw new Error('The HTML must embed its scripts and styles');
  }
}
if (/Geologica|font-family:\s*["']?Inter\b|__STREAM_INFO_LOCALE__/.test(html)) {
  throw new Error('Retired typography or localization remains');
}
console.log('Проверен автономный русский HTML Stream Info.');
