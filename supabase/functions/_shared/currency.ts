export const SUPPORTED_CURRENCIES = ["USD", "INR", "PHP", "IDR", "MYR"] as const;

export function assertSupportedCurrency(currency: string) {
  if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
}

export function toStripeMinorUnits(amount: number, currency: string): number {
  if (currency === "IDR") {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

export async function convertUsdToCurrency(adminClient: any, amountUsd: number, currency: string): Promise<number> {
  if (currency === "USD") {
    return Number(amountUsd.toFixed(2));
  }

  const { data, error } = await adminClient
    .from("exchange_rates")
    .select("rate_to_usd")
    .eq("currency_code", currency)
    .single();

  if (error || !data) {
    throw new Error(`Exchange rate not found for ${currency}`);
  }

  const rateToUsd = Number(data.rate_to_usd);
  if (!rateToUsd) {
    throw new Error(`Invalid exchange rate for ${currency}`);
  }

  const converted = amountUsd / rateToUsd;
  return currency === "IDR" ? Math.round(converted) : Number(converted.toFixed(2));
}
