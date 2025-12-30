import http from 'http';
import path from 'path';
import {URL} from 'url';
import chokidar from 'chokidar';
import {buildModule} from './viteBuilder.js';
import {scaffoldModule} from './scaffolder.js';
import fs from 'fs/promises';

const PORT = 4000;
let clients: http.ServerResponse[] = [];
const sendReloadEvent = () => {
	clients.forEach(client => client.write('data: reload\n\n'));
};


/**
 * Generates an HTML page to display file information.
 * @param info - The file statistics object.
 * @returns An HTML string.
 */
function generateInfoHtml(info: {
	path: string;
	fullPath: string;
	isFile: boolean;
	createdAt: string;
	modifiedAt: string;
	size: string;
}): string {
	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Info: ${info.path}</title>
			<style>
				body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2em; line-height: 1.6; }
				h1, h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.5em; }
				code { background-color: #eee; padding: 0.2em 0.4em; border-radius: 3px; }
				table { border-collapse: collapse; width: 100%; margin-top: 1em; }
				th, td { border: 1px solid #ccc; padding: 0.8em; text-align: left; }
				th { background-color: #f7f7f7; width: 150px; }
			</style>
		</head>
		<body>
			<h1>File Information</h1>
			<h2><code>${info.path}</code></h2>
			<table>
				<tr>
					<th>Full Path</th>
					<td><code>${info.fullPath}</code></td>
				</tr>
				<tr>
					<th>Type</th>
					<td>${info.isFile ? 'File' : 'Directory'}</td>
				</tr>
				<tr>
					<th>Size</th>
					<td>${info.size}</td>
				</tr>
				<tr>
					<th>Created At</th>
					<td>${new Date(info.createdAt).toLocaleString()}</td>
				</tr>
				<tr>
					<th>Modified At</th>
					<td>${new Date(info.modifiedAt).toLocaleString()}</td>
				</tr>
			</table>
		</body>
		</html>
	`;
}

const server = http.createServer(async (request, response) => {
	const {method, url} = request;
	const requestUrl = new URL(url || '/', `http://${request.headers.host}`);
	const {pathname, searchParams} = requestUrl;
	console.log(`Got ${method} request for ${pathname}`);

	try {
		// --- PING ROUTE ---
		if (pathname === '/ping') {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /ping.`);
			response.writeHead(200, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message: 'pong'}));

			// --- LIVE RELOAD EVENT STREAM ---
		} else if (pathname === '/events') {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /events.`);
			response.writeHead(200, {
				'Content-Type': 'text/event-stream',
				Connection: 'keep-alive',
				'Cache-Control': 'no-cache',
			});
			clients.push(response);
			request.on('close', () => {
				clients = clients.filter(c => c !== response);
			});

			// --- INFO ROUTE ---
		} else if (pathname.startsWith('/info/')) {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /info.`);
			const modulePath = pathname.replace('/info/', '');
			const fullPath = path.resolve(process.cwd(), 'src', modulePath);

			const stats = await fs.stat(fullPath);
			const info = {
				path: modulePath,
				fullPath: fullPath,
				isFile: stats.isFile(),
				isDirectory: stats.isDirectory(),
				createdAt: stats.birthtime.toISOString(),
				modifiedAt: stats.mtime.toISOString(),
				size: `${stats.size} bytes`,
			};

			const html = generateInfoHtml(info);
			response.writeHead(200, {'Content-Type': 'text/html'});
			response.end(html);
			// --- INIT ROUTE ---
		} else if (pathname.startsWith('/init/')) {
			if (method !== 'POST') throw new Error(`Method ${method} not allowed for /init.`);

			// Capture the original path the user entered
			const originalModulePath = pathname.replace('/init/', '');

			// Calculate the final path, appending /index.html if it's a directory
			let finalModulePath = originalModulePath;
			if (!finalModulePath.toLowerCase().endsWith('.html')) {
				finalModulePath = path.join(finalModulePath, 'index.html');
			}

			const result = await scaffoldModule(finalModulePath, originalModulePath);
			const message = `Scaffolding complete. Created ${result.created.length} file(s).`;
			response.writeHead(201, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: true, message, details: result}));
		} else if (pathname.startsWith('/build/')) {
			if (method !== 'GET') throw new Error(`Method ${method} not allowed for /build.`);
			let modulePath = pathname.replace('/build/', '');
			if (!modulePath.toLowerCase().endsWith('.html')) {
				modulePath = path.join(modulePath, 'index.html');
			}
			const shouldMinify = searchParams.get('minify') === 'true';
			const useLiveReload = searchParams.get('liveReload') === 'true';
			const configParam = searchParams.get('config');

			let html = await buildModule(modulePath, shouldMinify, configParam);
			if (useLiveReload) {
				const liveReloadScript = `
							<script>
								console.log('[Live Reload] Connecting to dev server...');
								const eventSource = new EventSource('/events');
								eventSource.onmessage = async function(event) {
									if (event.data === 'reload') {
										try {
											// register the webViewer as modified in the global fmPromise variable
											await fmPromise.performScript('fmPromise.onLiveReload', {
												webViewerName: fmPromise.webViewerName, 
												path : '${modulePath}'
											});
										} catch (error) {
											console.warn('Unable to set $$FMPROMISE_MODIFIED_WEBVIEWERS', error);
										}
										console.log('[Live Reload] Reloading page...');
										window.location.reload();
									}
								};
								eventSource.onerror = function(err) {
									console.error('[Live Reload] Connection error:', err);
								};
							</script>
						`;
				html += liveReloadScript
			}
			response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
			response.end(html);

			// --- NOT FOUND ---
		} else {
			response.writeHead(404, {'Content-Type': 'text/html'});
			response.end('<h1>404 Not Found</h1><p>Please use /ping, /init, /build, or /info endpoints.</p>');
		}

	} catch (error: any) {
		console.error(`Error processing request ${method} ${pathname}:`, error);
		if (error.code === 'ENOENT') {
			response.writeHead(404, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: `Path not found: ${pathname}`}));
		} else if (error.message.includes('Method not allowed')) {
			response.writeHead(405, {'Content-Type': 'application/json'});
			response.end(JSON.stringify({success: false, message: error.message}));
		} else {
			const isApiRoute = ['/init', '/info'].some(p => pathname.startsWith(p));
			if (isApiRoute) {
				response.writeHead(500, {'Content-Type': 'application/json'});
				response.end(JSON.stringify({success: false, message: error.message}));
			} else {
				response.writeHead(500, {'Content-Type': 'text/html'});
				response.end(`<h1>500 - Server Error</h1><pre>${error.message}</pre>`);
			}
		}
	}
});

server.listen(PORT, () => {
	console.log(`fmpromise-dev server started at http://localhost:${PORT}`);
	const srcDir = path.join(process.cwd(), 'src');
	console.log(`[Live Reload] Watching for file changes in: ${srcDir}`);
	chokidar.watch(srcDir, {
		ignored: /(^|[\/\\])\../,
		persistent: true,
		ignoreInitial: true,
	}).on('all', () => {
		sendReloadEvent();
	});
});
