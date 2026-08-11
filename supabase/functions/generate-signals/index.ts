import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Module-level so every function in this file (including executeStrategies,
// which calls the broker trade functions) can reach them without needing to
// thread them through as parameters.
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---- Types ----
interface AssetRow {
  id: string;
  symbol: string;
  market_type: string;
  name: string;
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  indicators_used: string[];
  risk_per_trade_pct: number;
  is_active: boolean;
  auto_trade: boolean;
  confidence_threshold: number;
  watched_markets: string[];
  watched_asset_ids: string[];
  execution_target: string;
}

interface ProfileRow {
  user_id: string;
  virtual_capital: number;
  max_concurrent_positions: number;
  daily_loss_limit_pct: number;
}

interface GeneratedSignal {
  id: string;
  asset_id: string;
  signal_type: string;
  confidence_score: number;
  signal_term: string;
}

// ---- Technical Indicators ----

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function smaAt(values: number[], period: number, endIdx: number): number | null {
  if (endIdx < period - 1) return null;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += values[i];
  return sum / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(emaVal);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
    result.push(emaVal);
  }
  return result;
}

// ---- Multi-timeframe confirmation ----
// Our raw candles come from one fetch cadence (~every 10 min). To approximate
// a higher timeframe without a second data feed, group consecutive raw
// candles into coarser bars (e.g. 6 bars ≈ roughly hourly) and read the trend
// off that coarser series. This is a real (if approximate) higher-timeframe
// read, not just a relabeled version of the same data — it smooths out the
// noise that produces false short-term signals.
function resampleCandles(candles: Candle[], groupSize: number): Candle[] {
  if (groupSize <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length === 0) continue;
    out.push({
      timestamp: group[group.length - 1].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

type HtfTrend = "bullish" | "bearish" | "neutral";

function higherTimeframeTrend(candles: Candle[], groupSize = 6): HtfTrend {
  const resampled = resampleCandles(candles, groupSize);
  const closes = resampled.map((c) => c.close);
  if (closes.length < 21) return "neutral"; // not enough resampled history to trust a read yet
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  if (fast === null || slow === null) return "neutral";
  const spread = Math.abs(fast - slow) / slow;
  if (spread < 0.0015) return "neutral"; // EMAs basically flat/tangled — no clear trend either way
  return fast > slow ? "bullish" : "bearish";
}

// Downgrades a short-term signal that fights the higher-timeframe trend,
// instead of trusting a fast/noisy read in isolation. Never invents a
// direction the base signal didn't already have — only softens conflicts.
function applyMtfConfirmation(signal: ScoreResult, htf: HtfTrend): ScoreResult {
  if (htf === "neutral") return signal;
  if (signal.signal_type === "buy" && htf === "bearish") {
    return {
      signal_type: "hold",
      confidence_score: Math.round(signal.confidence_score * 0.5),
      reasoning_text: `${signal.reasoning_text}. Downgraded: conflicts with bearish higher-timeframe trend`,
    };
  }
  if (signal.signal_type === "sell" && htf === "bullish") {
    return {
      signal_type: "hold",
      confidence_score: Math.round(signal.confidence_score * 0.5),
      reasoning_text: `${signal.reasoning_text}. Downgraded: conflicts with bullish higher-timeframe trend`,
    };
  }
  return signal;
}

function rsi(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsiAt(values: number[], period: number, endIdx: number): number | null {
  if (endIdx < period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = endIdx + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

function macd(values: number[]): MACDResult | null {
  if (values.length < 35) return null;
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const offset = ema12.length - ema26.length;
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = emaSeries(macdLine, 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalSeries.length > 0
    ? signalSeries[signalSeries.length - 1]
    : 0;
  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
  };
}

function macdAt(values: number[], endIdx: number): MACDResult | null {
  if (endIdx < 34) return null;
  const slice = values.slice(0, endIdx + 1);
  return macd(slice);
}

function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trueRanges.push(tr);
  }
  const slice = trueRanges.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
}

function bollingerBands(
  values: number[],
  period: number,
  stdDev: number,
): BollingerResult | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + stdDev * sd;
  const lower = mean - stdDev * sd;
  const lastClose = values[values.length - 1];
  const bandwidth = sd > 0 ? ((upper - lower) / mean) * 100 : 0;
  const percentB = sd > 0 ? ((lastClose - lower) / (upper - lower)) * 100 : 50;
  return { upper, middle: mean, lower, bandwidth, percentB };
}

function bollingerBandsAt(
  values: number[],
  period: number,
  stdDev: number,
  endIdx: number,
): BollingerResult | null {
  if (endIdx < period - 1) return null;
  const slice = values.slice(Math.max(0, endIdx - period + 1), endIdx + 1);
  if (slice.length < period) return null;
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + stdDev * sd;
  const lower = mean - stdDev * sd;
  const lastClose = values[endIdx];
  const bandwidth = sd > 0 ? ((upper - lower) / mean) * 100 : 0;
  const percentB = sd > 0 ? ((lastClose - lower) / (upper - lower)) * 100 : 50;
  return { upper, middle: mean, lower, bandwidth, percentB };
}

interface VolumeTrend {
  current: number;
  average: number;
  ratio: number;
  isHigh: boolean;
  isLow: boolean;
}

function volumeTrend(candles: Candle[], period: number): VolumeTrend | null {
  if (candles.length < period + 1) return null;
  const volumes = candles.map((c) => c.volume);
  const recent = volumes.slice(-period);
  const avg = recent.reduce((a, b) => a + b, 0) / period;
  const current = volumes[volumes.length - 1];
  if (avg <= 0) return { current, average: avg, ratio: 1, isHigh: false, isLow: false };
  const ratio = current / avg;
  return {
    current,
    average: avg,
    ratio,
    isHigh: ratio > 1.5,
    isLow: ratio < 0.5,
  };
}

interface SupportResistance {
  support: number | null;
  resistance: number | null;
  nearSupport: boolean;
  nearResistance: boolean;
}

function supportResistance(
  candles: Candle[],
  lookback: number,
  tolerancePct: number,
): SupportResistance {
  const slice = candles.slice(-lookback);
  if (slice.length < 5) {
    return { support: null, resistance: null, nearSupport: false, nearResistance: false };
  }
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const lastClose = slice[slice.length - 1].close;
  const tolerance = lastClose * (tolerancePct / 100);
  return {
    support,
    resistance,
    nearSupport: support !== null && Math.abs(lastClose - support) <= tolerance,
    nearResistance: resistance !== null && Math.abs(lastClose - resistance) <= tolerance,
  };
}

function supportResistanceAt(
  candles: Candle[],
  endIdx: number,
  lookback: number,
  tolerancePct: number,
): SupportResistance {
  const slice = candles.slice(Math.max(0, endIdx - lookback + 1), endIdx + 1);
  if (slice.length < 5) {
    return { support: null, resistance: null, nearSupport: false, nearResistance: false };
  }
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const lastClose = slice[slice.length - 1].close;
  const tolerance = lastClose * (tolerancePct / 100);
  return {
    support,
    resistance,
    nearSupport: support !== null && Math.abs(lastClose - support) <= tolerance,
    nearResistance: resistance !== null && Math.abs(lastClose - resistance) <= tolerance,
  };
}

// ---- All Indicators Bundle ----
interface AllIndicators {
  rsiVal: number | null;
  macdResult: MACDResult | null;
  ema9: number | null;
  ema21: number | null;
  sma50: number | null;
  sma200: number | null;
  atrVal: number | null;
  bb: BollingerResult | null;
  volTrend: VolumeTrend | null;
  sr: SupportResistance;
  lastClose: number;
  prevEma9: number | null;
  prevEma21: number | null;
  prevSma50: number | null;
  prevSma200: number | null;
}

function computeAllIndicators(candles: Candle[]): AllIndicators {
  const closes = candles.map((c) => c.close);
  const rsiVal = rsi(closes, 14);
  const macdResult = macd(closes);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atrVal = atr(candles, 14);
  const bb = bollingerBands(closes, 20, 2);
  const volTrend = volumeTrend(candles, 20);
  const sr = supportResistance(candles, 50, 2);

  const prevCloses = closes.slice(0, -1);
  const prevEma9 = prevCloses.length >= 9 ? ema(prevCloses, 9) : null;
  const prevEma21 = prevCloses.length >= 21 ? ema(prevCloses, 21) : null;
  const prevSma50 = prevCloses.length >= 50 ? sma(prevCloses, 50) : null;
  const prevSma200 = prevCloses.length >= 200 ? sma(prevCloses, 200) : null;

  return {
    rsiVal, macdResult, ema9, ema21, sma50, sma200, atrVal,
    bb, volTrend, sr, lastClose: closes[closes.length - 1],
    prevEma9, prevEma21, prevSma50, prevSma200,
  };
}

// ---- Scoring Logic ----

interface ScoreResult {
  signal_type: "buy" | "sell" | "hold";
  confidence_score: number;
  reasoning_text: string;
}

function shortTermScore(ind: AllIndicators): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // RSI
  if (ind.rsiVal !== null) {
    if (ind.rsiVal < 30) {
      score += 30;
      reasons.push(`RSI oversold at ${ind.rsiVal.toFixed(0)}`);
    } else if (ind.rsiVal > 70) {
      score -= 30;
      reasons.push(`RSI overbought at ${ind.rsiVal.toFixed(0)}`);
    } else if (ind.rsiVal < 45) {
      score += 12;
      reasons.push(`RSI bearish-neutral at ${ind.rsiVal.toFixed(0)}`);
    } else if (ind.rsiVal > 55) {
      score += 12;
      reasons.push(`RSI bullish-neutral at ${ind.rsiVal.toFixed(0)}`);
    } else {
      reasons.push(`RSI neutral at ${ind.rsiVal.toFixed(0)}`);
    }
  }

  // EMA crossover
  if (ind.ema9 !== null && ind.ema21 !== null && ind.prevEma9 !== null && ind.prevEma21 !== null) {
    const wasBullish = ind.prevEma9 > ind.prevEma21;
    const wasBearish = ind.prevEma9 < ind.prevEma21;
    const isBullish = ind.ema9 > ind.ema21;
    const isBearish = ind.ema9 < ind.ema21;

    if (isBullish && wasBearish) {
      score += 30;
      reasons.push("bullish EMA 9/21 crossover");
    } else if (isBearish && wasBullish) {
      score -= 30;
      reasons.push("bearish EMA 9/21 crossover");
    } else if (isBullish) {
      score += 10;
      reasons.push("EMA 9 above EMA 21 (bullish trend)");
    } else {
      score -= 10;
      reasons.push("EMA 9 below EMA 21 (bearish trend)");
    }
  }

  // MACD
  if (ind.macdResult !== null) {
    if (ind.macdResult.histogram > 0 && ind.macdResult.macd > ind.macdResult.signal) {
      score += 20;
      reasons.push("MACD turning positive");
    } else if (ind.macdResult.histogram < 0 && ind.macdResult.macd < ind.macdResult.signal) {
      score -= 20;
      reasons.push("MACD turning negative");
    } else if (ind.macdResult.histogram > 0) {
      score += 8;
      reasons.push("MACD histogram positive");
    } else {
      score -= 8;
      reasons.push("MACD histogram negative");
    }
  }

  // Bollinger Bands
  if (ind.bb !== null) {
    if (ind.bb.percentB < 20) {
      score += 18;
      reasons.push(`price near lower Bollinger Band (%B ${ind.bb.percentB.toFixed(0)})`);
    } else if (ind.bb.percentB > 80) {
      score -= 18;
      reasons.push(`price near upper Bollinger Band (%B ${ind.bb.percentB.toFixed(0)})`);
    }
    if (ind.bb.bandwidth > 5) {
      reasons.push(`volatility expanding (BB width ${ind.bb.bandwidth.toFixed(1)}%)`);
    }
  }

  // Volume trend confirmation
  if (ind.volTrend !== null) {
    if (ind.volTrend.isHigh) {
      if (score > 0) {
        score += 10;
        reasons.push(`volume ${ind.volTrend.ratio.toFixed(1)}x average confirms move`);
      } else if (score < 0) {
        score -= 10;
        reasons.push(`volume ${ind.volTrend.ratio.toFixed(1)}x average confirms sell-off`);
      }
    } else if (ind.volTrend.isLow) {
      score = Math.round(score * 0.7);
      reasons.push(`low volume (${ind.volTrend.ratio.toFixed(1)}x avg) weakens signal`);
    }
  }

  // Support/Resistance
  if (ind.sr.nearSupport) {
    score += 12;
    reasons.push("price near support level");
  } else if (ind.sr.nearResistance) {
    score -= 12;
    reasons.push("price near resistance level");
  }

  return buildScoreResult(score, reasons);
}

function longTermScore(ind: AllIndicators): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // SMA 50/200
  if (ind.sma50 !== null && ind.sma200 !== null) {
    if (ind.sma50 > ind.sma200) {
      score += 25;
      reasons.push("SMA 50 above SMA 200 (golden cross trend)");
    } else {
      score -= 25;
      reasons.push("SMA 50 below SMA 200 (death cross trend)");
    }

    if (ind.prevSma50 !== null && ind.prevSma200 !== null) {
      const wasBullish = ind.prevSma50 > ind.prevSma200;
      const isBullish = ind.sma50 > ind.sma200;
      if (isBullish && !wasBullish) {
        score += 20;
        reasons.push("fresh golden cross detected");
      } else if (!isBullish && wasBullish) {
        score -= 20;
        reasons.push("fresh death cross detected");
      }
    }
  } else {
    reasons.push("insufficient data for SMA 50/200");
  }

  // SMA 50 slope
  if (ind.sma50 !== null && ind.prevSma50 !== null) {
    const slope = ind.sma50 - ind.prevSma50;
    if (slope > 0) {
      score += 15;
      reasons.push("SMA 50 rising (positive momentum)");
    } else if (slope < 0) {
      score -= 15;
      reasons.push("SMA 50 falling (negative momentum)");
    }
  }

  // RSI confirmation
  if (ind.rsiVal !== null) {
    if (ind.rsiVal > 55) {
      score += 10;
      reasons.push(`RSI supports uptrend at ${ind.rsiVal.toFixed(0)}`);
    } else if (ind.rsiVal < 45) {
      score -= 10;
      reasons.push(`RSI supports downtrend at ${ind.rsiVal.toFixed(0)}`);
    }
  }

  // Bollinger Bands for long-term context
  if (ind.bb !== null) {
    if (ind.bb.percentB < 15) {
      score += 10;
      reasons.push(`price at lower Bollinger Band (%B ${ind.bb.percentB.toFixed(0)}), potential reversal zone`);
    } else if (ind.bb.percentB > 85) {
      score -= 10;
      reasons.push(`price at upper Bollinger Band (%B ${ind.bb.percentB.toFixed(0)}), potential exhaustion`);
    }
  }

  // Support/Resistance for long-term
  if (ind.sr.nearSupport) {
    score += 8;
    reasons.push("price near long-term support");
  } else if (ind.sr.nearResistance) {
    score -= 8;
    reasons.push("price near long-term resistance");
  }

  return buildScoreResult(score, reasons);
}

function buildScoreResult(score: number, reasons: string[]): ScoreResult {
  const clamped = Math.max(-100, Math.min(100, score));
  let signal_type: "buy" | "sell" | "hold";
  let confidence_score: number;

  if (clamped > 15) {
    signal_type = "buy";
    confidence_score = Math.round(Math.abs(clamped));
  } else if (clamped < -15) {
    signal_type = "sell";
    confidence_score = Math.round(Math.abs(clamped));
  } else {
    signal_type = "hold";
    confidence_score = Math.round(100 - Math.abs(clamped));
  }

  confidence_score = Math.max(5, Math.min(100, confidence_score));

  const reasoning_text = reasons.length > 0
    ? reasons.join(", ")
    : "No clear signal from available indicators";

  return { signal_type, confidence_score, reasoning_text };
}

// ---- Backtesting ----

interface BacktestResult {
  win_rate_pct: number;
  avg_return_pct: number;
  total_signals_tested: number;
}

function runBacktest(
  candles: Candle[],
  signalTerm: "short_term" | "long_term",
  lookbackDays: number,
  forwardWindow: number,
): BacktestResult {
  const closes = candles.map((c) => c.close);
  const minData = signalTerm === "short_term" ? 35 : 200;
  if (closes.length < minData + forwardWindow) {
    return { win_rate_pct: 0, avg_return_pct: 0, total_signals_tested: 0 };
  }

  let wins = 0;
  let totalReturn = 0;
  let totalSignals = 0;
  const startIndex = Math.max(minData, closes.length - lookbackDays);

  for (let i = startIndex; i < closes.length - forwardWindow; i++) {
    const sliceCandles = candles.slice(0, i + 1);
    const sliceCloses = sliceCandles.map((c) => c.close);

    // Compute indicators at this point in history
    const rsiVal = rsiAt(sliceCloses, 14, i);
    const macdResult = macdAt(sliceCloses, i);
    const ema9 = sliceCloses.length >= 9 ? ema(sliceCloses.slice(0, i + 1), 9) : null;
    const ema21 = sliceCloses.length >= 21 ? ema(sliceCloses.slice(0, i + 1), 21) : null;
    const sma50 = smaAt(sliceCloses, 50, i);
    const sma200 = smaAt(sliceCloses, 200, i);
    const bb = bollingerBandsAt(sliceCloses, 20, 2, i);
    const volTrend = sliceCandles.length >= 21
      ? (() => {
          const vols = sliceCandles.slice(-21).map((c) => c.volume);
          const avg = vols.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
          const current = vols[20];
          if (avg <= 0) return { ratio: 1, isHigh: false, isLow: false };
          const ratio = current / avg;
          return { ratio, isHigh: ratio > 1.5, isLow: ratio < 0.5 };
        })()
      : null;
    const sr = supportResistanceAt(sliceCandles, i, 50, 2);

    const prevCloses = sliceCloses.slice(0, -1);
    const prevEma9 = prevCloses.length >= 9 ? ema(prevCloses, 9) : null;
    const prevEma21 = prevCloses.length >= 21 ? ema(prevCloses, 21) : null;
    const prevSma50 = prevCloses.length >= 50 ? sma(prevCloses, 50) : null;
    const prevSma200 = prevCloses.length >= 200 ? sma(prevCloses, 200) : null;

    const ind: AllIndicators = {
      rsiVal, macdResult, ema9, ema21, sma50, sma200,
      atrVal: null, bb, volTrend, sr,
      lastClose: closes[i],
      prevEma9, prevEma21, prevSma50, prevSma200,
    };

    const result = signalTerm === "short_term"
      ? shortTermScore(ind)
      : longTermScore(ind);

    if (result.signal_type === "hold") continue;
    if (result.confidence_score < 20) continue;

    totalSignals++;
    const entryPrice = closes[i];
    const exitPrice = closes[Math.min(i + forwardWindow, closes.length - 1)];
    const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const isWin = result.signal_type === "buy"
      ? returnPct > 0
      : returnPct < 0;

    if (isWin) wins++;
    totalReturn += result.signal_type === "buy" ? returnPct : -returnPct;
  }

  return {
    win_rate_pct: totalSignals > 0 ? Math.round((wins / totalSignals) * 10000) / 100 : 0,
    avg_return_pct: totalSignals > 0 ? Math.round((totalReturn / totalSignals) * 10000) / 10000 : 0,
    total_signals_tested: totalSignals,
  };
}

async function calculateAndStoreAccuracy(
  supabase: ReturnType<typeof createClient>,
  assets: AssetRow[],
  allCandles: Map<string, Candle[]>,
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const asset of assets) {
    const candles = allCandles.get(asset.id);
    if (!candles || candles.length < 50) continue;

    for (const term of ["short_term", "long_term"] as const) {
      const forwardWindow = term === "short_term" ? 5 : 14;
      const bt = runBacktest(candles, term, 90, forwardWindow);
      if (bt.total_signals_tested === 0) continue;

      rows.push({
        asset_id: asset.id,
        signal_term: term,
        lookback_days: 90,
        win_rate_pct: bt.win_rate_pct,
        avg_return_pct: bt.avg_return_pct,
        total_signals_tested: bt.total_signals_tested,
        calculated_at: now,
      });
    }
  }

  if (rows.length === 0) return;

  // Upsert accuracy data
  await supabase
    .from("strategy_accuracy")
    .upsert(rows, { onConflict: "asset_id,signal_term,lookback_days" });
}

// ---- Trade Execution Logic ----

interface AssetIndicator {
  asset: AssetRow;
  atrVal: number | null;
  lastClose: number;
  stSignal: ScoreResult;
  ltSignal: ScoreResult;
  signalRows: { short_term: string; long_term: string };
}

interface TradeExecutionResult {
  strategy_id: string;
  strategy_name: string;
  trades_created: number;
  suggestions_created: number;
  skipped: string[];
}

async function notify(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  type: "trade_opened" | "trade_closed_win" | "trade_closed_loss" | "risk_limit_hit" | "broker_error",
  title: string,
  message: string,
): Promise<void> {
  // Best-effort — a notification failing to write should never block trading.
  try {
    await supabase.from("notifications").insert({ user_id: userId, type, title, message });
  } catch {
    // ignore
  }
}

function calculatePositionSize(
  capital: number,
  riskPct: number,
  entryPrice: number,
  stopLoss: number,
): { quantity: number; riskAmount: number } {
  const riskAmount = capital * (riskPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare <= 0 || entryPrice <= 0) return { quantity: 0, riskAmount };

  let quantity = riskAmount / riskPerShare;

  // Safety cap: regardless of how tight the computed stop-loss distance is
  // (e.g. from unusually flat/low-volatility price data), never size a position
  // worth more than 25% of the account's capital. This bounds worst-case
  // exposure from a degenerate risk-per-share value instead of trusting it blindly.
  const MAX_POSITION_VALUE_PCT = 0.25;
  const maxPositionValue = capital * MAX_POSITION_VALUE_PCT;
  const positionValue = quantity * entryPrice;
  if (positionValue > maxPositionValue) {
    quantity = maxPositionValue / entryPrice;
  }

  return { quantity, riskAmount };
}

function shouldExecuteForStrategy(
  strategy: StrategyRow,
  signal: ScoreResult,
  signalTerm: string,
): boolean {
  if (strategy.type !== signalTerm) return false;
  if (signal.signal_type === "hold") return false;
  if (signal.confidence_score < strategy.confidence_threshold) return false;
  return true;
}

function assetMatchesStrategy(
  asset: AssetRow,
  strategy: StrategyRow,
): boolean {
  if (strategy.watched_asset_ids.length > 0) {
    return strategy.watched_asset_ids.includes(asset.id);
  }
  if (strategy.watched_markets.length > 0) {
    return strategy.watched_markets.includes(asset.market_type);
  }
  return true;
}

async function checkDailyLossLimit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  profile: ProfileRow,
): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("trades")
    .select("pnl")
    .eq("user_id", userId)
    .eq("status", "closed")
    .gte("closed_at", todayStart.toISOString());

  const dailyPnl = (data ?? []).reduce((sum, t) => sum + Number(t.pnl), 0);
  const maxLoss = profile.virtual_capital * (profile.daily_loss_limit_pct / 100);
  return dailyPnl < -maxLoss;
}

async function countOpenTrades(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "open");
  return count ?? 0;
}

async function executeStrategies(
  supabase: ReturnType<typeof createClient>,
  indicators: Map<string, AssetIndicator>,
  signalsByAsset: Map<string, { short_term: string; long_term: string }>,
): Promise<TradeExecutionResult[]> {
  const { data: strategies, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("is_active", true);

  if (error || !strategies || strategies.length === 0) return [];

  const userIds = [...new Set(strategies.map((s) => s.user_id))];
  const { data: profiles } = await supabase
    .from("users_profile")
    .select("user_id, virtual_capital, max_concurrent_positions, daily_loss_limit_pct")
    .in("user_id", userIds);

  const profileMap = new Map<string, ProfileRow>();
  for (const p of (profiles ?? []) as ProfileRow[]) {
    profileMap.set(p.user_id, p);
  }

  const results: TradeExecutionResult[] = [];

  // Pre-fetch which (strategy, asset) pairs already have an open or pending
  // position, so we don't stack duplicate trades on the same asset every time
  // signals are generated. One query up front instead of one per iteration.
  const { data: existingTrades } = await supabase
    .from("trades")
    .select("strategy_id, asset_id")
    .in("status", ["open", "pending"]);
  const openPositionKeys = new Set(
    (existingTrades ?? []).map((t: { strategy_id: string | null; asset_id: string }) => `${t.strategy_id}:${t.asset_id}`),
  );

  for (const strategy of strategies as StrategyRow[]) {
    const profile = profileMap.get(strategy.user_id);
    if (!profile) {
      results.push({
        strategy_id: strategy.id,
        strategy_name: strategy.name,
        trades_created: 0,
        suggestions_created: 0,
        skipped: ["no profile found"],
      });
      continue;
    }

    let tradesCreated = 0;
    let suggestionsCreated = 0;
    let riskLimitNotified = false;
    const skipped: string[] = [];

    for (const [assetId, ind] of indicators) {
      if (!assetMatchesStrategy(ind.asset, strategy)) continue;

      const signalTerm = strategy.type as "short_term" | "long_term";
      const signal = signalTerm === "short_term" ? ind.stSignal : ind.ltSignal;

      if (!shouldExecuteForStrategy(strategy, signal, signalTerm)) continue;

      if (openPositionKeys.has(`${strategy.id}:${assetId}`)) {
        skipped.push(`${ind.asset.symbol}: already has an open/pending position for this strategy`);
        continue;
      }

      if (ind.atrVal === null || ind.lastClose <= 0) {
        skipped.push(`${ind.asset.symbol}: no ATR data`);
        continue;
      }

      // Guard against degenerate volatility readings (e.g. from a burst of
      // near-identical price snapshots collected close together, or a
      // genuinely dead/illiquid market). A near-zero ATR produces a
      // stop-loss sitting right on top of the entry price, which then gets
      // triggered by ordinary noise almost immediately — this isn't a real
      // trading opportunity, it's a data artifact.
      const atrPctOfPrice = ind.atrVal / ind.lastClose;
      const MIN_ATR_PCT = 0.0005; // 0.05% — below this, the stop distance isn't meaningful
      if (atrPctOfPrice < MIN_ATR_PCT) {
        skipped.push(`${ind.asset.symbol}: volatility too low to size a meaningful stop (ATR ${(atrPctOfPrice * 100).toFixed(3)}% of price)`);
        continue;
      }

      const atrDistance = ind.atrVal * 1.5;
      const isBuy = signal.signal_type === "buy";
      const entryPrice = ind.lastClose;
      const stopLoss = isBuy ? entryPrice - atrDistance : entryPrice + atrDistance;
      const takeProfit = isBuy ? entryPrice + atrDistance * 2 : entryPrice - atrDistance * 2;

      const { quantity } = calculatePositionSize(
        profile.virtual_capital,
        strategy.risk_per_trade_pct,
        entryPrice,
        stopLoss,
      );

      if (quantity <= 0) {
        skipped.push(`${ind.asset.symbol}: quantity zero`);
        continue;
      }

      const signalId = signalsByAsset.get(assetId)?.[signalTerm];
      const tradeType = isBuy ? "long" : "short";

      // Determine execution mode based on strategy's execution_target.
      // Each live broker only applies to the market type it actually supports:
      // Binance testnet + CoinDCX -> crypto only, 5paisa -> stocks only.
      const isTestnet = strategy.execution_target === "testnet_live" && ind.asset.market_type === "crypto";
      const isCoindcx = strategy.execution_target === "coindcx_live" && ind.asset.market_type === "crypto";
      const isFivepaisa = strategy.execution_target === "fivepaisa_live" && ind.asset.market_type === "stocks";
      const executionMode = isTestnet
        ? "testnet_live"
        : isCoindcx
        ? "coindcx_live"
        : isFivepaisa
        ? "fivepaisa_live"
        : "paper";

      const tradeRow = {
        user_id: strategy.user_id,
        strategy_id: strategy.id,
        asset_id: assetId,
        signal_id: signalId ?? null,
        trade_type: tradeType,
        entry_price: entryPrice,
        quantity,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        status: strategy.auto_trade ? "open" : "pending",
        is_paper_trade: true,
        opened_at: strategy.auto_trade ? new Date().toISOString() : null,
        execution_mode: executionMode,
      };

      if (strategy.auto_trade) {
        const dailyLossExceeded = await checkDailyLossLimit(supabase, strategy.user_id, profile);
        if (dailyLossExceeded) {
          skipped.push(`${ind.asset.symbol}: daily loss limit reached`);
          if (!riskLimitNotified) {
            riskLimitNotified = true;
            await notify(
              supabase,
              strategy.user_id,
              "risk_limit_hit",
              "Daily loss limit reached",
              `"${strategy.name}" has hit its daily loss limit (${profile.daily_loss_limit_pct}%). New trades are paused for this strategy until tomorrow.`,
            );
          }
          continue;
        }

        const openCount = await countOpenTrades(supabase, strategy.user_id);
        if (openCount >= profile.max_concurrent_positions) {
          skipped.push(`${ind.asset.symbol}: max concurrent positions (${profile.max_concurrent_positions})`);
          continue;
        }

        const { data: insertedTrade, error: insertErr } = await supabase
          .from("trades")
          .insert(tradeRow)
          .select("id")
          .single();
        if (insertErr) {
          skipped.push(`${ind.asset.symbol}: ${insertErr.message}`);
          continue;
        }

        const modeLabel = executionMode === "paper" ? "paper" : executionMode.replace("_live", "").toUpperCase();
        await notify(
          supabase,
          strategy.user_id,
          "trade_opened",
          `${tradeType === "long" ? "Long" : "Short"} opened: ${ind.asset.symbol}`,
          `"${strategy.name}" opened a ${tradeType} position on ${ind.asset.symbol} at ${entryPrice.toFixed(2)} (${modeLabel}).`,
        );

        // If a live broker mode, place the order with that broker
        if (isTestnet || isCoindcx) {
          const functionName = isTestnet ? "binance-testnet-trade" : "coindcx-trade";
          const brokerLabel = isTestnet ? "Binance testnet" : "CoinDCX";
          try {
            const orderSide = isBuy ? "BUY" : "SELL";
            const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                action: "place_order",
                trade_id: insertedTrade.id,
                symbol: ind.asset.symbol,
                side: orderSide,
                quantity,
              }),
            });
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              skipped.push(`${ind.asset.symbol}: ${brokerLabel} error: ${errData.error ?? resp.statusText}`);
              await notify(
                supabase,
                strategy.user_id,
                "broker_error",
                `${brokerLabel} order failed: ${ind.asset.symbol}`,
                `${errData.error ?? resp.statusText}`,
              );
            }
          } catch (e) {
            skipped.push(`${ind.asset.symbol}: ${brokerLabel} unreachable: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else if (isFivepaisa) {
          if (!ind.asset.fivepaisa_scrip_code) {
            skipped.push(`${ind.asset.symbol}: no 5paisa ScripCode mapped for this asset yet — set assets.fivepaisa_scrip_code to enable live execution. Trade recorded in paper mode.`);
          } else {
            try {
              const orderSide = isBuy ? "BUY" : "SELL";
              const resp = await fetch(`${supabaseUrl}/functions/v1/fivepaisa-trade`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({
                  action: "place_order",
                  trade_id: insertedTrade.id,
                  scrip_code: ind.asset.fivepaisa_scrip_code,
                  side: orderSide,
                  quantity,
                }),
              });
              if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                skipped.push(`${ind.asset.symbol}: 5paisa error: ${errData.error ?? resp.statusText}`);
              }
            } catch (e) {
              skipped.push(`${ind.asset.symbol}: 5paisa unreachable: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        tradesCreated++;
      } else {
        const { error: insertErr } = await supabase.from("trades").insert(tradeRow);
        if (insertErr) {
          skipped.push(`${ind.asset.symbol}: ${insertErr.message}`);
          continue;
        }
        suggestionsCreated++;
      }
    }

    results.push({
      strategy_id: strategy.id,
      strategy_name: strategy.name,
      trades_created: tradesCreated,
      suggestions_created: suggestionsCreated,
      skipped,
    });
  }

  return results;
}

// ---- Main Handler ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);

    let backtestOnly = false;
    try {
      const body = await req.json();
      backtestOnly = body?.backtest_only === true;
    } catch {
      // no body or invalid JSON — normal invocation
    }

    // Load all assets
    const { data: assets, error: assetError } = await supabase
      .from("assets")
      .select("id, symbol, market_type, name, fivepaisa_scrip_code");
    if (assetError) throw new Error(`Failed to load assets: ${assetError.message}`);
    if (!assets || assets.length === 0) {
      return jsonResponse({ success: true, message: "No assets found", inserted: 0 });
    }

    // Load all candles upfront for backtesting
    const allCandles = new Map<string, Candle[]>();
    for (const asset of assets as AssetRow[]) {
      const { data: candles } = await supabase
        .from("market_data")
        .select("timestamp, open, high, low, close, volume")
        .eq("asset_id", asset.id)
        .order("timestamp", { ascending: true })
        .limit(300);
      if (candles && candles.length >= 35) {
        allCandles.set(asset.id, candles as Candle[]);
      }
    }

    // Always recalculate accuracy
    await calculateAndStoreAccuracy(supabase, assets as AssetRow[], allCandles);

    if (backtestOnly) {
      return jsonResponse({
        success: true,
        message: "Strategy accuracy recalculated",
        assets_processed: allCandles.size,
      });
    }

    let totalInserted = 0;
    const perAsset: Record<string, { short_term?: ScoreResult; long_term?: ScoreResult; skipped?: string }> = {};
    const errors: string[] = [];
    const indicators = new Map<string, AssetIndicator>();
    const signalsByAsset = new Map<string, { short_term: string; long_term: string }>();

    for (const asset of assets as AssetRow[]) {
      const candles = allCandles.get(asset.id);
      if (!candles || candles.length < 35) {
        perAsset[asset.symbol] = { skipped: "insufficient data" };
        continue;
      }

      const ind = computeAllIndicators(candles);
      const htfTrend = higherTimeframeTrend(candles);
      const st = applyMtfConfirmation(shortTermScore(ind), htfTrend);
      const lt = longTermScore(ind);

      const atrPct = ind.atrVal !== null && ind.lastClose > 0
        ? (ind.atrVal / ind.lastClose) * 100
        : null;

      const stReasoning = atrPct !== null
        ? `${st.reasoning_text}. Volatility (ATR) ${atrPct.toFixed(1)}%`
        : st.reasoning_text;

      const now = new Date().toISOString();
      const rowsToInsert = [
        {
          strategy_id: null,
          asset_id: asset.id,
          signal_type: st.signal_type,
          confidence_score: st.confidence_score,
          reasoning_text: stReasoning,
          generated_at: now,
          signal_term: "short_term",
        },
        {
          strategy_id: null,
          asset_id: asset.id,
          signal_type: lt.signal_type,
          confidence_score: lt.confidence_score,
          reasoning_text: lt.reasoning_text,
          generated_at: now,
          signal_term: "long_term",
        },
      ];

      const { data: insertedSignals, error: insertError } = await supabase
        .from("signals")
        .insert(rowsToInsert)
        .select("id, asset_id, signal_type, confidence_score, signal_term");

      if (insertError) {
        errors.push(`${asset.symbol}: ${insertError.message}`);
        continue;
      }

      totalInserted += 2;
      perAsset[asset.symbol] = { short_term: st, long_term: lt };

      const inserted = insertedSignals as GeneratedSignal[];
      indicators.set(asset.id, {
        asset,
        atrVal: ind.atrVal,
        lastClose: ind.lastClose,
        stSignal: st,
        ltSignal: lt,
        signalRows: { short_term: "", long_term: "" },
      });
      const stSig = inserted.find((s) => s.signal_term === "short_term");
      const ltSig = inserted.find((s) => s.signal_term === "long_term");
      signalsByAsset.set(asset.id, {
        short_term: stSig?.id ?? "",
        long_term: ltSig?.id ?? "",
      });
    }

    // Execute user strategies
    const executionResults = await executeStrategies(supabase, indicators, signalsByAsset);

    return jsonResponse({
      success: true,
      inserted: totalInserted,
      perAsset,
      strategies_executed: executionResults,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return jsonResponse(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
