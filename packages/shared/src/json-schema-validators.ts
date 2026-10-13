import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

const MAX_CACHED_VALIDATORS = 256;

/** String format of a state value holding Mermaid source that a render slot
 * draws as an SVG diagram. */
export const mermaidStateFormat = "maket-mermaid";

/** Longest Mermaid source a `maket-mermaid` string may hold. */
export const MAX_MERMAID_SOURCE_LENGTH = 20_000;

/** The string formats Maket registers on every JSON Schema it compiles. */
export const jsonSchemaFormats: Readonly<
	Record<string, (value: string) => boolean>
> = {
	[mermaidStateFormat]: (value) => value.length <= MAX_MERMAID_SOURCE_LENGTH,
};

type CompiledSchema =
	| { ok: true; validate: ValidateFunction }
	| { ok: false; errors: ErrorObject[] };

const compiled = new Map<string, CompiledSchema>();

/**
 * The Ajv validator of a JSON Schema, compiled once per distinct schema text.
 * Every schema gets its own Ajv instance, so `$id` values never collide; an
 * invalid schema yields its meta-schema errors instead of a validator.
 */
export function compiledJsonSchema(schema: object): CompiledSchema {
	const key = JSON.stringify(schema);
	const cached = compiled.get(key);
	if (cached) return remember(key, cached);
	return remember(key, compile(schema));
}

function compile(schema: object): CompiledSchema {
	const ajv = new Ajv({ allErrors: true, strict: false });
	for (const [name, validate] of Object.entries(jsonSchemaFormats)) {
		ajv.addFormat(name, { type: "string", validate });
	}
	return ajv.validateSchema(schema)
		? { ok: true, validate: ajv.compile(schema) }
		: { ok: false, errors: [...(ajv.errors ?? [])] };
}

function remember(key: string, result: CompiledSchema): CompiledSchema {
	compiled.delete(key);
	compiled.set(key, result);
	while (compiled.size > MAX_CACHED_VALIDATORS) {
		const oldest = compiled.keys().next().value;
		if (oldest === undefined) break;
		compiled.delete(oldest);
	}
	return result;
}
