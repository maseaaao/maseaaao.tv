import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export function accessibleTunaScript(html) {
 const reduced='if (matchMedia("(prefers-reduced-motion: reduce)").matches) { cfg.anim = 0; cfg.swap = 0; }';
 const replacement=`const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
        const fullMotion = {anim: cfg.anim, swap: cfg.swap};
        const syncMotion = () => {
          cfg.anim = motionPreference.matches ? 0 : fullMotion.anim;
          cfg.swap = motionPreference.matches ? 0 : fullMotion.swap;
          el.root.style.setProperty("--art-swap", cfg.swap + "ms");
          if (motionPreference.matches && state.fadeAnimation) {
            state.fadeAnimation.cancel(); state.fadeAnimation = null;
          }
        };
        motionPreference.addEventListener("change", syncMotion);
        syncMotion();`;
 assert.ok(html.includes(reduced),'Recheck upstream Tuna motion code before generating');
 assert.ok(html.includes('state.playing = playing;'),'Recheck upstream playback accessibility binding');
 return html.replace(reduced,replacement).replace('state.playing = playing;','state.playing = playing;\n          el.player.setAttribute("aria-hidden", String(!playing));');
}

export async function buildTunaWidget() {
 const site=path.resolve(import.meta.dirname,'..');
 const obs=path.dirname(site);
 const originalPath=path.join(obs,'obs-tuna-widget.html');
 const original=await fs.readFile(originalPath,'utf8');
 let html=original.replace(/\s*<link rel="stylesheet"[^>]+>/g,'').replace(/<style>[\s\S]*?<\/style>/,'<link rel="stylesheet" href="maseaaao.tv/src/widgets/tuna-widget.css">');
 html=html.replace('<head>','<head>\n    <title>Музыка — maseaaao</title>');
 html=html.replace('<main id="player"','<main aria-label="Музыка" aria-hidden="true" id="player"');
 html=html.replace('<section id="content">','<div id="content" role="status" aria-live="polite" aria-atomic="true">').replace('</section>','</div>');
 html=html.replace('<div id="title"></div>','<p id="title"></p>').replace('<div id="subtitle"></div>','<p id="subtitle"></p>');
 html=accessibleTunaScript(html);
 const output=path.join(obs,'obs-tuna-widget-dark.html');
 await fs.writeFile(output,html);
 assert.equal(await fs.readFile(originalPath,'utf8'),original);
 return {output,originalUnchanged:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)) console.log(JSON.stringify(await buildTunaWidget()));
