import { requestUrl } from "obsidian";
import { DummyTranslate } from "./dummy-translate";
import type {
	DetectionResult,
	GlossaryFetchResult,
	GlossaryUploadResult,
	LanguagesFetchResult,
	ServiceOptions,
	ServiceSettings,
	TranslationResult,
	ValidationResult,
} from "./types";

interface DeeplBaseResult {
	message?: string;
}

interface DeepLTranslationResult extends DeeplBaseResult {
	translations: Array<{ text: string; detected_source_language?: string }>;
}

type DeepLLanguageResult = Array<{ language: string; name: string; supports_formality?: boolean }> & DeeplBaseResult;

interface DeepLGlossaryPairsResult extends DeeplBaseResult {
	supported_languages: Array<{ source_lang: string; target_lang: string }>;
}

export class Deepl extends DummyTranslate {
	#api_key: string | undefined;
	#host: string;
	id = "deepl";

	byte_limit = 130000;

	constructor(settings: ServiceSettings) {
		super();
		this.#api_key = settings.api_key;
		this.#host = "https://api-free.deepl.com/v2"; // 강제 고정
	}

	update_settings(settings: ServiceSettings): void {
		this.#api_key = settings.api_key ?? this.#api_key;
		this.#host = "https://api-free.deepl.com/v2"; // 강제 고정
	}

	async service_validate(): Promise<ValidationResult> {
		if (!this.#api_key)
			return { status_code: 400, valid: false, message: "API key was not specified" };

		this.#host = "https://api-free.deepl.com/v2"; // 강제 고정

		const response = await requestUrl({
			throw: false,
			url: `${this.#host}/usage`,
			method: "GET",
			headers: {
				"Authorization": "DeepL-Auth-Key " + this.#api_key,
			},
		});

		if (response.status !== 200)
			return { status_code: response.status, valid: false, message: "Invalid API key" };

		return {
			status_code: response.status,
			valid: response.status === 200,
			host: this.#host,
		};
	}

	async service_detect(text: string): Promise<DetectionResult> {
		const response = await requestUrl({
			throw: false,
			url: `${this.#host}/translate?` + new URLSearchParams({
				text: text,
				target_lang: "en",
			}),
			method: "POST",
			headers: {
				"Authorization": "DeepL-Auth-Key " + this.#api_key,
			},
		});

		const data: DeepLTranslationResult = response.json;

		if (response.status !== 200)
			return { status_code: response.status, message: data.message };

		return {
			status_code: response.status,
			detected_languages: [{ language: data.translations[0].detected_source_language!.toLowerCase() }],
		};
	}

	async service_translate(
		text: string,
		from: string,
		to: string,
		options: ServiceOptions = {},
	): Promise<TranslationResult> {
		let split_sentences = "1";
		if (options.split_sentences === "punctuation")
			split_sentences = "nonewlines";
		else if (options.split_sentences === "newline" || options.split_sentences === "both")
			split_sentences = "0";

		const preserve_formatting = options.preserve_formatting ? "1" : "0";

		let formality = "default";
		if (options.formality === "formal")
			formality = "prefer_more";
		else if (options.formality === "informal")
			formality = "prefer_less";

		const response = await requestUrl({
			throw: false,
			url: `${this.#host}/translate?` + new URLSearchParams({
				text: text,
				source_lang: from === "auto" ? "" : from,
				target_lang: to,
				glossary_id: options.glossary || "",
				split_sentences: split_sentences,
				preserve_formatting: preserve_formatting,
				formality: formality,
			}),
			method: "POST",
			headers: {
				"Authorization": "DeepL-Auth-Key " + this.#api_key,
			},
		});

		const data: DeepLTranslationResult = response.json;

		if (response.status !== 200)
			return { status_code: response.status, message: data.message };

		return {
			status_code: response.status,
			translation: data.translations[0].text,
			detected_language: (from === "auto" && data.translations[0].detected_source_language) ?
				data.translations[0].detected_source_language.toLowerCase() :
				undefined,
		};
	}

	async service_languages(): Promise<LanguagesFetchResult> {
		const response = await requestUrl({
			throw: false,
			url: `${this.#host}/languages`,
			method: "POST",
			headers: {
				"Authorization": "DeepL-Auth-Key " + this.#api_key,
			},
		});

		const data: DeepLLanguageResult = response.json;

		if (response.status !== 200)
			return { status_code: response.status, message: data.message };

		return {
			status_code: response.status,
			languages: data.map((o) => o.language.toLowerCase()),
		};
	}

	async service_glossary_languages(): Promise<GlossaryFetchResult> {
		const response = await requestUrl({
			throw: false,
			url: `${this.#host}/glossary-language-pairs`,
			method: "GET",
			headers: {
				"Authorization": "DeepL-Auth-Key " + this.#api_key,
			},
		});

		const data: DeepLGlossaryPairsResult = response.json;

		if (response.status !== 200)
			return { status_code: response.status, message: data.message };

		const glossary_pairs: Record<string, string[]> = {};
		for (const pair of data["supported_languages"]) {
			if (pair["source_lang"] in glossary_pairs)
				glossary_pairs[pair["source_lang"]].push(pair["target_lang"]);
			else
				glossary_pairs[pair["source_lang"]] = [pair["target_lang"]];
		}
		return {
			status_code: response.status,
			message: data.message,
			languages: glossary_pairs,
		};
	}

	async service_glossary_upload(
		glossary: Record<string, [string, string]>,
		glossary_languages: Record<string, string[]>,
		previous_glossaries_ids: Record<string, string>,
	): Promise<GlossaryUploadResult> {
		for (const id of Object.values(previous_glossaries_ids)) {
			const response = await requestUrl({
				throw: false,
				url: `${this.#host}/glossaries/${id}`,
				method: "DELETE",
				headers: {
					"Authorization": "DeepL-Auth-Key " + this.#api_key,
				},
			});
			if (response.status > 400)
				return { status_code: response.status, message: response.json?.message };
		}

		const identifiers: Record<string, string> = {};

		for (const source_lang in glossary_languages) {
			for (const target_lang of glossary_languages[source_lang]) {
				if (glossary[source_lang + "_" + target_lang]) {
					const response = await requestUrl({
						throw: false,
						url: `${this.#host}/glossaries?`,
						body: "" + new URLSearchParams({
							name: source_lang + "" + target_lang,
							source_lang: source_lang,
							target_lang: target_lang,
							entries: glossary[source_lang + "_" + target_lang].map((entry) =>
								entry[0] + "\t" + entry[1]
							).join("\n"),
							entries_format: "tsv",
						}),
						method: "POST",
						headers: {
							"Authorization": "DeepL-Auth-Key " + this.#api_key,
							"Content-Type": "application/x-www-form-urlencoded",
						},
					});

					const data = response.json;

					if (response.status > 400)
						return { status_code: response.status, message: data.detail || data.message };

					identifiers[source_lang + "_" + target_lang] = data["glossary_id"];
				}
			}
		}

		return {
			status_code: 200,
			identifiers: identifiers,
		};
	}

	has_autodetect_capability(): boolean {
		return true;
	}
}
