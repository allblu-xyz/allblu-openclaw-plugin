import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const ALLBLU_ORIGIN = "https://www.allblu.xyz";
const QUOTE_ENDPOINT = `${ALLBLU_ORIGIN}/api/quotes`;
const SUPPORTED_ASSETS_ENDPOINT = `${ALLBLU_ORIGIN}/api/supported-assets`;
const REQUEST_TIMEOUT_MS = 10_000;
const ASSET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;

type JsonRecord = Record<string, unknown>;

type SupportedAsset = {
  asset_slug: string;
  symbol: string;
  name: string;
  network: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAssetSlug(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 64 ||
    !ASSET_SLUG_PATTERN.test(normalized)
  ) {
    throw new Error(`${fieldName} must be a canonical allblu asset slug.`);
  }
  return normalized;
}

function validateAmount(value: string): string {
  const amount = value.trim();
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(
      "amount must be a positive decimal with at most 30 integer digits and 18 decimal places.",
    );
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("amount must be a positive finite decimal.");
  }
  return amount;
}

function requiredFiniteNumber(payload: JsonRecord, field: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("allblu returned an invalid quote response.");
  }
  return value;
}

function optionalFiniteNumber(payload: JsonRecord, field: string): number | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("allblu returned an invalid quote response.");
  }
  return value;
}

function requiredString(payload: JsonRecord, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("allblu returned an invalid quote response.");
  }
  return value;
}

function sanitizedHttpError(status: number): Error {
  if (status === 400) return new Error("allblu rejected the quote request.");
  if (status === 404) return new Error("No quote is currently available for this pair and amount.");
  if (status === 429) return new Error("allblu is receiving too many quote requests. Try again later.");
  if (status === 503) return new Error("allblu quoting is temporarily unavailable.");
  return new Error("Unable to retrieve a quote from allblu.");
}

async function fetchQuotePayload(
  url: URL,
  executionSignal: AbortSignal | undefined,
): Promise<JsonRecord> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = executionSignal
    ? AbortSignal.any([executionSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw sanitizedHttpError(response.status);

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error("allblu returned an invalid quote response.");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("allblu")) throw error;
    if (error instanceof Error && error.message.startsWith("No quote")) throw error;
    if (signal.aborted) throw new Error("The allblu quote request timed out or was cancelled.");
    throw new Error("Unable to retrieve a quote from allblu.");
  }
}

function sanitizedAssetsHttpError(status: number): Error {
  if (status === 404) return new Error("The allblu supported asset catalog is not available yet.");
  if (status === 429) {
    return new Error("allblu is receiving too many asset catalog requests. Try again later.");
  }
  if (status === 503) return new Error("The allblu supported asset catalog is temporarily unavailable.");
  return new Error("Unable to retrieve the supported asset catalog from allblu.");
}

function validatedCatalogString(
  payload: JsonRecord,
  field: keyof SupportedAsset,
  maxLength: number,
): string {
  const value = payload[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("allblu returned an invalid supported asset catalog.");
  }
  return value;
}

function validateSupportedAssetsPayload(payload: unknown): SupportedAsset[] {
  if (!isRecord(payload) || !Array.isArray(payload.assets) || payload.assets.length > 256) {
    throw new Error("allblu returned an invalid supported asset catalog.");
  }

  const slugs = new Set<string>();
  return payload.assets.map((value) => {
    if (!isRecord(value)) {
      throw new Error("allblu returned an invalid supported asset catalog.");
    }

    const assetSlug = validatedCatalogString(value, "asset_slug", 64);
    if (!ASSET_SLUG_PATTERN.test(assetSlug) || assetSlug !== assetSlug.toLowerCase()) {
      throw new Error("allblu returned an invalid supported asset catalog.");
    }
    if (slugs.has(assetSlug)) {
      throw new Error("allblu returned a supported asset catalog with duplicate slugs.");
    }
    slugs.add(assetSlug);

    return {
      asset_slug: assetSlug,
      symbol: validatedCatalogString(value, "symbol", 32),
      name: validatedCatalogString(value, "name", 128),
      network: validatedCatalogString(value, "network", 128),
    };
  });
}

async function fetchSupportedAssets(executionSignal: AbortSignal | undefined): Promise<SupportedAsset[]> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = executionSignal
    ? AbortSignal.any([executionSignal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetch(SUPPORTED_ASSETS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw sanitizedAssetsHttpError(response.status);

    const payload: unknown = await response.json();
    return validateSupportedAssetsPayload(payload);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("allblu")) throw error;
    if (error instanceof Error && error.message.startsWith("The allblu")) throw error;
    if (signal.aborted) {
      throw new Error("The allblu asset catalog request timed out or was cancelled.");
    }
    throw new Error("Unable to retrieve the supported asset catalog from allblu.");
  }
}

const QuoteOutputSchema = Type.Object(
  {
    source_asset: Type.String(),
    destination_asset: Type.String(),
    input_amount: Type.String(),
    estimated_receive_amount: Type.Number(),
    estimated_exchange_rate: Type.Object(
      {
        value: Type.Number(),
        unit: Type.String(),
      },
      { additionalProperties: false },
    ),
    minimum_receive_amount: Type.Union([Type.Number(), Type.Null()]),
    estimated_duration_seconds: Type.Number(),
    quote_timestamp: Type.String(),
    swap_url: Type.String(),
  },
  { additionalProperties: false },
);

const AssetSchema = Type.Object(
  {
    asset_slug: Type.String(),
    symbol: Type.String(),
    name: Type.String(),
    network: Type.String(),
  },
  { additionalProperties: false },
);

const AssetsOutputSchema = Type.Object(
  {
    available: Type.Boolean(),
    reason: Type.Union([Type.String(), Type.Null()]),
    assets: Type.Array(AssetSchema),
  },
  { additionalProperties: false },
);

export default defineToolPlugin({
  id: "allblu-crypto-swap-quotes",
  name: "allblu Crypto Swap Quotes",
  description: "Read-only cryptocurrency swap quotes and supported assets from allblu.",
  tools: (tool) => [
    tool({
      name: "allblu_get_quote",
      label: "Get allblu Quote",
      description:
        "Get a live estimated cross-chain cryptocurrency swap quote from allblu. This tool never creates an order or handles funds.",
      parameters: Type.Object(
        {
          from_asset: Type.String({
            minLength: 1,
            maxLength: 64,
            description: "Canonical allblu source asset slug, for example btc or usdc-sol.",
          }),
          to_asset: Type.String({
            minLength: 1,
            maxLength: 64,
            description: "Canonical allblu destination asset slug, for example eth or usdt-tron.",
          }),
          amount: Type.String({
            minLength: 1,
            maxLength: 49,
            description: "Positive decimal amount of the source asset. Exponential notation is not accepted.",
          }),
        },
        { additionalProperties: false },
      ),
      outputSchema: QuoteOutputSchema,
      async execute({ from_asset, to_asset, amount }, _config, context) {
        const sourceAsset = normalizeAssetSlug(from_asset, "from_asset");
        const destinationAsset = normalizeAssetSlug(to_asset, "to_asset");
        if (sourceAsset === destinationAsset) {
          throw new Error("from_asset and to_asset must be different.");
        }
        const inputAmount = validateAmount(amount);

        const url = new URL(QUOTE_ENDPOINT);
        url.searchParams.set("from", sourceAsset);
        url.searchParams.set("to", destinationAsset);
        url.searchParams.set("amount", inputAmount);

        const payload = await fetchQuotePayload(url, context.signal);
        const responseSource = requiredString(payload, "from");
        const responseDestination = requiredString(payload, "to");
        if (responseSource !== sourceAsset || responseDestination !== destinationAsset) {
          throw new Error("allblu returned an invalid quote response.");
        }

        const estimatedExchangeRate = requiredFiniteNumber(payload, "estimatedPrice");
        return {
          source_asset: sourceAsset,
          destination_asset: destinationAsset,
          input_amount: inputAmount,
          estimated_receive_amount: requiredFiniteNumber(payload, "egressAmount"),
          estimated_exchange_rate: {
            value: estimatedExchangeRate,
            unit: `${destinationAsset} per ${sourceAsset}`,
          },
          minimum_receive_amount: optionalFiniteNumber(payload, "minReceiveAmount"),
          estimated_duration_seconds: requiredFiniteNumber(
            payload,
            "estimatedDurationSeconds",
          ),
          quote_timestamp: requiredString(payload, "updatedAt"),
          swap_url: `${ALLBLU_ORIGIN}/swap/${sourceAsset}-to-${destinationAsset}`,
        };
      },
    }),
    tool({
      name: "allblu_list_assets",
      label: "List allblu Assets",
      description:
        "List the canonical assets configured for swap support by allblu. This does not guarantee real-time quote availability.",
      parameters: Type.Object({}, { additionalProperties: false }),
      outputSchema: AssetsOutputSchema,
      async execute(_params, _config, context) {
        const assets = await fetchSupportedAssets(context.signal);
        return {
          available: true,
          reason: null,
          assets,
        };
      },
    }),
  ],
});
