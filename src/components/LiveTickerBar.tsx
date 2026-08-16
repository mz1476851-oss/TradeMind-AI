import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Asset } from '@/lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface TickerItem {
  asset: Asset;
  price: number;
  changePct: number;
}

export function LiveTickerBar() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const flashRef = useRef<Record<string, 'up' | 'down' | null>>({});
  const [, forceRender] = useState(0);

  const load = useCallback(async () => {
    const { data: assets } = await supabase
      .from('assets')
      .select('id, symbol, market_type, name, fivepaisa_scrip_code')
      .order('market_type')
      .order('symbol');
    if (!assets || assets.length === 0) return;

    const results: TickerItem[] = [];
    for (const asset of assets as Asset[]) {
      const { data: candles } = await supabase
        .from('market_data')
        .select('close, timestamp')
        .eq('asset_id', asset.id)
        .order('timestamp', { ascending: false })
        .limit(30);
      if (!candles || candles.length === 0) continue;
      const latest = Number(candles[0].close);
      const oldest = Number(candles[candles.length - 1].close);
      const changePct = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;

      const prevItem = items.find((i) => i.asset.id === asset.id);
      if (prevItem && prevItem.price !== latest) {
        flashRef.current[asset.id] = latest > prevItem.price ? 'up' : 'down';
        setTimeout(() => {
          flashRef.current[asset.id] = null;
          forceRender((n) => n + 1);
        }, 900);
      }

      results.push({ asset, price: latest, changePct });
    }
    setItems(results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();

    // Realtime: refresh the moment a new price snapshot lands, instead of
    // waiting for the next poll interval.
    const channel = supabase
      .channel('ticker-market-data')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'market_data' }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (items.length === 0) return null;

  return (
    <div className="border-b border-slate-800 bg-slate-950/60 overflow-hidden">
      <div className="flex gap-6 px-6 py-2 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const flash = flashRef.current[item.asset.id];
          return (
            <div
              key={item.asset.id}
              className={`flex items-center gap-2 shrink-0 px-2 py-0.5 rounded transition-colors duration-500 ${
                flash === 'up' ? 'bg-emerald-500/20' : flash === 'down' ? 'bg-rose-500/20' : ''
              }`}
            >
              <span className="text-xs font-semibold text-slate-300">{item.asset.symbol}</span>
              <span className="text-xs text-white tabular-nums">
                {item.price >= 1000 ? item.price.toFixed(2) : item.price.toFixed(item.price >= 1 ? 4 : 6)}
              </span>
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                item.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {item.changePct >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
