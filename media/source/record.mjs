import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
const [, , mode, outDir, only] = process.argv; // mode: stills | video
const FPS = 25, HERE = process.cwd().split(String.fromCharCode(92)).join('/');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9341', `--user-data-dir=${HERE}/prof`, '--hide-scrollbars', '--disable-gpu', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const l = await (await fetch('http://127.0.0.1:9341/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch (e) {} }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1120, deviceScaleFactor: 1, mobile: false });
const base = 'file:///' + HERE + '/scenes.html';
await send('Page.navigate', { url: base }); await sleep(1500);
let list = await ev('window.SCENES'); if (only) list = list.filter((k) => only.split(',').includes(k));
mkdirSync(outDir, { recursive: true });
for (const k of list) {
	await send('Page.navigate', { url: `${base}?s=${k}` }); await sleep(800); await ev('document.fonts.ready.then(()=>1)'); await sleep(300);
	const dur = await ev('window.DUR');
	const shot = async (t, q = 92) => { await ev(`render(${t})`); return (await send('Page.captureScreenshot', { format: 'jpeg', quality: q })).result.data; };
	// Still: the finished state.
	writeFileSync(`${outDir}/subscriptions-${k}.jpg`, Buffer.from(await shot(dur), 'base64'));
	if (mode === 'video') {
		const fdir = `${HERE}/frames`; rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir);
		const n = Math.round(dur * FPS);
		for (let f = 0; f <= n; f++) writeFileSync(`${fdir}/f${String(f).padStart(4, '0')}.jpg`, Buffer.from(await shot(f / FPS, 95), 'base64'));
		// Hold the last frame 1s, then loop-friendly fade isn't needed: video loops back to the empty start.
		const r = spawnSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', `${fdir}/f%04d.jpg`, '-vf', 'tpad=stop_mode=clone:stop_duration=1.2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', `${outDir}/subscriptions-${k}.mp4`]);
		if (r.status !== 0) console.log(r.stderr.toString().slice(-500));
	}
	console.log('done', k);
}
ws.close(); chrome.kill(); process.exit(0);
