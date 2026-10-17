export type SpendInput = {
  geminiInputTokens: number;
  geminiOutputTokens: number;
  ocrPages: number;
  gcsStorageGb: number;
  gcsEgressGb: number;
  profitMarginPercent?: number;
};

export type SpendBreakdown = {
  geminiInputCostInr: number;
  geminiOutputCostInr: number;
  geminiTotalCostInr: number;
  ocrCostInr: number;
  gcsStorageCostInr: number;
  gcsEgressCostInr: number;
  infraCostInr: number;
  baseCostInr: number;
  profitInr: number;
  finalChargeInr: number;
  rates: {
    geminiInputPer1kInr: number;
    geminiOutputPer1kInr: number;
    ocrPerPageInr: number;
    gcsStoragePerGbInr: number;
    gcsEgressPerGbInr: number;
    infraFlatInr: number;
    profitMarginPercent: number;
  };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateSpendWithProfit(input: SpendInput): SpendBreakdown {
  const geminiInputPer1kInr = envNumber('BILLING_GEMINI_INPUT_PER_1K_INR', 0.15);
  const geminiOutputPer1kInr = envNumber('BILLING_GEMINI_OUTPUT_PER_1K_INR', 0.6);
  const ocrPerPageInr = envNumber('BILLING_OCR_PER_PAGE_INR', 0.8);
  const gcsStoragePerGbInr = envNumber('BILLING_GCS_STORAGE_PER_GB_INR', 2.0);
  const gcsEgressPerGbInr = envNumber('BILLING_GCS_EGRESS_PER_GB_INR', 7.0);
  const infraFlatInr = envNumber('BILLING_INFRA_FLAT_INR', 0.3);
  const profitMarginPercent =
    input.profitMarginPercent !== undefined
      ? input.profitMarginPercent
      : envNumber('BILLING_PROFIT_MARGIN_PERCENT', 30);

  const safeInputTokens = Math.max(0, input.geminiInputTokens || 0);
  const safeOutputTokens = Math.max(0, input.geminiOutputTokens || 0);
  const safeOcrPages = Math.max(0, input.ocrPages || 0);
  const safeGcsStorageGb = Math.max(0, input.gcsStorageGb || 0);
  const safeGcsEgressGb = Math.max(0, input.gcsEgressGb || 0);

  const geminiInputCostInr = (safeInputTokens / 1000) * geminiInputPer1kInr;
  const geminiOutputCostInr = (safeOutputTokens / 1000) * geminiOutputPer1kInr;
  const geminiTotalCostInr = geminiInputCostInr + geminiOutputCostInr;
  const ocrCostInr = safeOcrPages * ocrPerPageInr;
  const gcsStorageCostInr = safeGcsStorageGb * gcsStoragePerGbInr;
  const gcsEgressCostInr = safeGcsEgressGb * gcsEgressPerGbInr;

  const baseCostInr = geminiTotalCostInr + ocrCostInr + gcsStorageCostInr + gcsEgressCostInr + infraFlatInr;
  const profitInr = baseCostInr * (Math.max(0, profitMarginPercent) / 100);
  const finalChargeInr = baseCostInr + profitInr;

  return {
    geminiInputCostInr: round2(geminiInputCostInr),
    geminiOutputCostInr: round2(geminiOutputCostInr),
    geminiTotalCostInr: round2(geminiTotalCostInr),
    ocrCostInr: round2(ocrCostInr),
    gcsStorageCostInr: round2(gcsStorageCostInr),
    gcsEgressCostInr: round2(gcsEgressCostInr),
    infraCostInr: round2(infraFlatInr),
    baseCostInr: round2(baseCostInr),
    profitInr: round2(profitInr),
    finalChargeInr: round2(finalChargeInr),
    rates: {
      geminiInputPer1kInr,
      geminiOutputPer1kInr,
      ocrPerPageInr,
      gcsStoragePerGbInr,
      gcsEgressPerGbInr,
      infraFlatInr,
      profitMarginPercent,
    },
  };
}

export function inrToPaise(amountInr: number): number {
  const safe = Math.max(0, amountInr || 0);
  return Math.round(safe * 100);
}
