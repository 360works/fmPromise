import {build, loadConfigFromFile, mergeConfig, type InlineConfig, type UserConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import path from 'path';
import type {OutputAsset} from 'rollup';

// Update the function signature to accept the minify flag
export const buildModule = async (moduleHtmlPath: string, minify: boolean, configJsonString?: string | null): Promise<string> => {
	const absoluteInputFile = path.resolve(process.cwd(), 'src', moduleHtmlPath);
	const buildRoot = path.dirname(absoluteInputFile);

	// Base/default Vite config that we always enforce
	const baseConfig: InlineConfig = {
		root: buildRoot,
		plugins: [viteSingleFile()],
		logLevel: 'silent',
		build: {
			write: false,
			assetsDir: '',
			minify: minify,
			rollupOptions: {
				input: {
					index: absoluteInputFile,
				},
			},
		},
	};

	// Attempt to load a user vite.config.ts from the module's root and merge it.
	let finalConfig: InlineConfig = baseConfig;
	const userConfigPath = path.join(buildRoot, 'vite.config.ts');
	try {
		const loaded = await loadConfigFromFile({ command: 'build', mode: minify ? 'production' : 'development' }, userConfigPath, buildRoot);
		if (loaded && loaded.config) {
			const userConfig = loaded.config as UserConfig;
			// Merge user config into base config
			finalConfig = mergeConfig(baseConfig, userConfig);

			// Ensure required defaults are preserved/overridden as needed
			finalConfig.root = buildRoot; // enforce building from the detected root
			finalConfig.build = {
				...(finalConfig.build ?? {}),
				write: false,
				assetsDir: '',
				// Use the passed-in boolean to control minification
				minify: minify,
				rollupOptions: {
					...(finalConfig.build?.rollupOptions ?? {}),
					input: {
						index: absoluteInputFile,
					},
				},
			};

			// Append the viteSingleFile base plugin after user plugins
			const basePlugins = (baseConfig.plugins ?? []) as any[];
			const userPluginsRaw = userConfig.plugins as any;
			const userPlugins: any[] = Array.isArray(userPluginsRaw)
				? userPluginsRaw.flat()
				: userPluginsRaw
					? [userPluginsRaw]
					: [];
			const combined = [...userPlugins, ...basePlugins];
			// Deduplicate by plugin name to avoid double-registering common plugins
			const seen = new Set<string>();
			finalConfig.plugins = combined.filter((p: any) => {
				const name = p?.name ?? Math.random().toString(36);
				if (seen.has(name)) return false;
				seen.add(name);
				return true;
			});
		}
	} catch {
		// No user config present or failed to load; proceed with base config
		finalConfig = baseConfig;
	}

	const result = await build(finalConfig);

	if (!('output' in result)) {
		throw new Error('Vite build did not return a valid output.');
	}

	const htmlAsset = result.output.find(
		(item): item is OutputAsset => item.type === 'asset' && item.fileName.endsWith('.html')
	);

	if (!htmlAsset || typeof htmlAsset.source !== 'string') {
		throw new Error(`Vite build did not produce a valid HTML file for: ${moduleHtmlPath}`);
	}

	let finalHtml = htmlAsset.source;
	if (configJsonString) {
		finalHtml += `<script>window.FMPROMISE_CONFIG = ${configJsonString};</script>`;
	}
	return finalHtml;
};
