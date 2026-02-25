// --- Types ---

export type ScalarTypeName = 'field' | 'table' | 'layout' | 'string' | 'number' | 'boolean' | 'json';

export interface ScalarParam {
	type: ScalarTypeName;
	required?: boolean;
	description?: string;
}

export interface ArrayParam {
	type: 'array';
	items: ScalarTypeName;
	required?: boolean;
	description?: string;
}

export interface ObjectParam {
	type: 'object';
	properties: ConfigSchema;
	required?: boolean;
	description?: string;
}

export type ParamDef = ScalarParam | ArrayParam | ObjectParam;
export type ConfigSchema = Record<string, ParamDef>;

type ScalarResolved<T extends ScalarTypeName> =
	T extends 'number' ? number :
	T extends 'boolean' ? boolean :
	T extends 'json' ? unknown :
	string;

type ParamResolved<P extends ParamDef> =
	P extends { type: 'object'; properties: infer Props extends ConfigSchema } ? ConfigResolved<Props> :
	P extends { type: 'array'; items: infer I extends ScalarTypeName } ? ScalarResolved<I>[] :
	P extends { type: infer T extends ScalarTypeName } ? ScalarResolved<T> : never;

export type ConfigResolved<S extends ConfigSchema> = {
	[K in keyof S]: S[K] extends { required: false } ? ParamResolved<S[K]> | undefined : ParamResolved<S[K]>
};

// --- Error Class ---

export class ConfigValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigValidationError';
	}
}

// --- Internal Helpers ---

function getWebViewerName(): string {
	return (window as any).FMPROMISE_WEB_VIEWER_NAME
		?? new URLSearchParams(window.location.search).get('webViewerName')
		?? 'fmPromiseWebViewer';
}

function getRawConfig(): Record<string, any> | null {
	const raw = (window as any).FMPROMISE_CONFIG;
	if (raw == null) return null;
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (typeof raw === 'object') return raw;
	return null;
}

function resolveScalar(key: string, value: any, type: ScalarTypeName, errors: string[]): string | number | boolean | unknown | undefined {
	if (type === 'json') {
		// Accept any JSON value. If it arrived as a string, try to parse it.
		if (typeof value === 'string') {
			try { return JSON.parse(value); } catch { /* return as-is */ }
		}
		return value;
	}
	if (type === 'boolean') {
		return Boolean(value);
	}
	if (type === 'number') {
		const n = Number(value);
		if (isNaN(n)) {
			errors.push(`"${key}": expected a number, got ${JSON.stringify(value)}`);
			return undefined;
		}
		return n;
	}
	if (typeof value !== 'string') {
		errors.push(`"${key}": expected a string, got ${JSON.stringify(value)}`);
		return undefined;
	}
	if (type === 'field') {
		return value.split('::').pop()!;
	}
	if (type === 'table') {
		return value.split('::')[0];
	}
	// layout | string
	return value;
}

function resolveValue(key: string, value: any, def: ParamDef, errors: string[]): any {
	if (def.type === 'object') {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			errors.push(`"${key}": expected an object, got ${JSON.stringify(value)}`);
			return undefined;
		}
		return resolveSchema(def.properties, value, `${key}.`, errors);
	}

	if (def.type === 'array') {
		let arr: any[];
		if (Array.isArray(value)) {
			arr = value;
		} else if (typeof value === 'string') {
			try {
				const parsed = JSON.parse(value);
				if (!Array.isArray(parsed)) {
					errors.push(`"${key}": expected an array, got ${JSON.stringify(value)}`);
					return undefined;
				}
				arr = parsed;
			} catch {
				errors.push(`"${key}": expected an array or JSON array string, got ${JSON.stringify(value)}`);
				return undefined;
			}
		} else {
			errors.push(`"${key}": expected an array, got ${JSON.stringify(value)}`);
			return undefined;
		}
		const itemErrors: string[] = [];
		const resolved = arr.map((item, i) => resolveScalar(`${key}[${i}]`, item, def.items, itemErrors));
		errors.push(...itemErrors);
		return itemErrors.length === 0 ? resolved : undefined;
	}

	// scalar
	return resolveScalar(key, value, def.type, errors);
}

function resolveSchema(schema: ConfigSchema, raw: Record<string, any>, pathPrefix: string, errors: string[]): Record<string, any> {
	const result: Record<string, any> = {};
	for (const key of Object.keys(schema)) {
		const def = schema[key];
		const isRequired = def.required !== false;
		const fullKey = `${pathPrefix}${key}`;
		const value = raw[key];

		if (value === undefined || value === null) {
			if (isRequired) {
				errors.push(`"${fullKey}": required field is missing`);
			}
			result[key] = undefined;
			continue;
		}

		result[key] = resolveValue(fullKey, value, def, errors);
	}
	return result;
}

// --- FileMaker Calc Generation ---

function scalarPlaceholder(key: string, type: ScalarTypeName): string {
	switch (type) {
		case 'field':
		case 'table':
			return `GetFieldName ( ReplaceMe::${key} )`;
		case 'layout':
			return `"Enter layout name"`;
		case 'string':
			return `"Enter ${key} value"`;
		case 'number':
			return `0`;
		case 'boolean':
			return `False`;
		case 'json':
			return `"[]"`;
	}
}

function scalarJsonType(type: ScalarTypeName): string {
	if (type === 'number')  return 'JSONNumber';
	if (type === 'boolean') return 'JSONBoolean';
	if (type === 'json')    return 'JSONRaw';
	return 'JSONString';
}

function generateSchemaCalc(schema: ConfigSchema, indent: string): string {
	const entries: string[] = [];

	for (const key of Object.keys(schema)) {
		const def = schema[key];

		if (def.type === 'object') {
			const inner = generateSchemaCalc(def.properties, indent + '  ');
			entries.push(`[ "${key}" ;\n${indent}      JSONSetElement ( "" ;\n${inner}\n${indent}    ) ; JSONRaw ]`);
		} else if (def.type === 'array') {
			const itemPlaceholder = scalarPlaceholder(key, def.items);
			const itemJsonType = scalarJsonType(def.items);
			entries.push(`[ "${key}" ; JSONSetElement ( "[]" ; [ 0 ; ${itemPlaceholder} ; ${itemJsonType} ] ) ; JSONRaw ]`);
		} else {
			const placeholder = scalarPlaceholder(key, def.type);
			const jsonType = scalarJsonType(def.type);
			entries.push(`[ "${key}" ; ${placeholder} ; ${jsonType} ]`);
		}
	}

	return entries.map(e => `${indent}    ${e}`).join(' ;\n');
}

function generateCalc(schema: ConfigSchema, webViewerName: string): string {
	const inner = generateSchemaCalc(schema, '');
	return `_fmPromiseWebViewerContentsWithConfig ( "${webViewerName}" ;\n  JSONSetElement ( "" ;\n${inner}\n  )\n)`;
}

// --- Error UI ---

function renderErrorUI(calc: string, errors: string[]): void {
	const errorItems = errors.map(e => `<li>${e}</li>`).join('\n    ');
	document.body.innerHTML = `<div style="font-family: system-ui; padding: 20px; max-width: 900px; color: #1a1a1a;">
  <h2 style="color: #c00; font-size: 15px; margin: 0 0 8px 0;">fmPromise configuration required</h2>
  <p style="font-size: 13px; color: #555; margin: 0 0 10px 0;">
    Copy this calculation into your web viewer URL:
  </p>
  <pre id="fmp-calc" style="background:#f4f4f4; border:1px solid #ddd; padding:12px; border-radius:4px; font-size:12px; overflow:auto; white-space:pre; font-family:monospace; margin:0 0 8px 0;">${calc.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  <button onclick="navigator.clipboard.writeText(document.getElementById('fmp-calc').textContent).then(()=>this.textContent='Copied!').catch(()=>{})" style="font-size:12px; padding:4px 10px; cursor:pointer; margin-bottom:12px;">Copy</button>
  <ul style="font-size:13px; color:#c00; margin:0; padding-left:20px;">
    ${errorItems}
  </ul>
</div>`;
}

// --- Main Export ---

export function validateFmPromiseConfig<S extends ConfigSchema>(
	schema: S,
	options?: { appendToBody?: boolean }
): ConfigResolved<S> {
	const appendToBody = options?.appendToBody !== false;
	const webViewerName = getWebViewerName();
	const calc = generateCalc(schema, webViewerName);

	const raw = getRawConfig();
	const errors: string[] = [];

	if (!raw) {
		errors.push('window.FMPROMISE_CONFIG is not set or could not be parsed');
		if (appendToBody) renderErrorUI(calc, errors);
		throw new ConfigValidationError(errors.join('; '));
	}

	const resolved = resolveSchema(schema, raw, '', errors);

	if (errors.length > 0) {
		if (appendToBody) renderErrorUI(calc, errors);
		throw new ConfigValidationError(errors.join('; '));
	}

	return resolved as ConfigResolved<S>;
}
