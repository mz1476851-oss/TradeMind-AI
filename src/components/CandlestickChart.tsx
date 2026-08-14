interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OverlayLine {
  price: number;
  label: string;
  color: string;
}

interface CandlestickChartProps {
  candles: Candle[];
  height?: number;
  overlays?: OverlayLine[];
}

export function CandlestickChart({ candles, height = 380, overlays = [] }: CandlestickChartProps) {
  if (candles.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-slate-500">
        No data for this timeframe yet.
      </div>
    );
  }

  const width = 1000;
  const padding = { top: 20, right: 60, bottom: 30, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const overlayPrices = overlays.map((o) => o.price);
  const highs = [...candles.map((c) => c.high), ...overlayPrices];
  const lows = [...candles.map((c) => c.low), ...overlayPrices];
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = (maxPrice - minPrice) * 1.05 || 1; // small headroom so overlay lines near the edge aren't clipped
  const rangeMin = minPrice - (maxPrice - minPrice) * 0.025;

  const candleSlot = chartWidth / candles.length;
  const bodyWidth = Math.max(candleSlot * 0.6, 1);

  const yFor = (price: number) => padding.top + chartHeight - ((price - rangeMin) / priceRange) * chartHeight;

  const gridLines = 5;
  const gridPrices = Array.from({ length: gridLines + 1 }, (_, i) => rangeMin + (priceRange / gridLines) * i);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      {/* Grid lines + price labels */}
      {gridPrices.map((price, i) => {
        const y = yFor(price);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#1e293b"
              strokeWidth={1}
            />
            <text x={width - padding.right + 6} y={y + 3} fontSize={10} fill="#64748b">
              {price >= 1000 ? price.toFixed(0) : price.toFixed(price >= 1 ? 2 : 6)}
            </text>
          </g>
        );
      })}

      {/* Candles */}
      {candles.map((c, i) => {
        const x = padding.left + i * candleSlot + candleSlot / 2;
        const isUp = c.close >= c.open;
        const color = isUp ? '#34d399' : '#fb7185';
        const bodyTop = yFor(Math.max(c.open, c.close));
        const bodyBottom = yFor(Math.min(c.open, c.close));
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

        return (
          <g key={c.timestamp + i}>
            {/* Wick */}
            <line
              x1={x}
              y1={yFor(c.high)}
              x2={x}
              y2={yFor(c.low)}
              stroke={color}
              strokeWidth={1}
            />
            {/* Body */}
            <rect
              x={x - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              fill={color}
            />
          </g>
        );
      })}

      {/* Overlay lines: entry / stop-loss / take-profit, so the chart shows
          exactly what the bot is doing on this position */}
      {overlays.map((o, i) => {
        const y = yFor(o.price);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke={o.color}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text x={padding.left + 4} y={y - 4} fontSize={10} fill={o.color} fontWeight={600}>
              {o.label} {o.price >= 1000 ? o.price.toFixed(2) : o.price.toFixed(6)}
            </text>
          </g>
        );
      })}

      {/* X-axis: first/last timestamp labels */}
      <text x={padding.left} y={height - 8} fontSize={10} fill="#64748b">
        {new Date(candles[0].timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </text>
      <text x={width - padding.right} y={height - 8} fontSize={10} fill="#64748b" textAnchor="end">
        {new Date(candles[candles.length - 1].timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </text>
    </svg>
  );
}
