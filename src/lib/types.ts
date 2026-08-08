export type MarketType = 'stocks' | 'crypto' | 'forex';
export type RiskTolerance = 'low' | 'medium' | 'high';
export type SignalType = 'buy' | 'sell' | 'hold';
export type SignalTerm = 'short_term' | 'long_term';
export type TradeType = 'long' | 'short';
export type TradeStatus = 'pending' | 'open' | 'closed' | 'cancelled';
export type StrategyType = 'short_term' | 'long_term';

export interface UserProfile {
  user_id: string;
  display_name: string;
  virtual_capital: number;
  risk_tolerance: RiskTolerance;
  preferred_markets: MarketType[];
  created_at: string;
  max_concurrent_positions: number;
  daily_loss_limit_pct: number;
  starting_capital: number;
}

export interface Asset {
  id: string;
  symbol: string;
  market_type: MarketType;
  name: string;
}

export type ExecutionTarget = 'paper' | 'testnet_live' | 'coindcx_live' | 'fivepaisa_live';
export type BrokerType = 'coindcx' | 'fivepaisa';

export interface Strategy {
  id: string;
  user_id: string;
  name: string;
  type: StrategyType;
  indicators_used: string[];
  risk_per_trade_pct: number;
  is_active: boolean;
  created_at: string;
  auto_trade: boolean;
  confidence_threshold: number;
  watched_markets: MarketType[];
  watched_asset_ids: string[];
  execution_target: ExecutionTarget;
}

export interface Signal {
  id: string;
  strategy_id: string | null;
  asset_id: string;
  signal_type: SignalType;
  confidence_score: number;
  reasoning_text: string;
  generated_at: string;
  signal_term: SignalTerm;
  risk_note: string | null;
  recommended_confidence: number | null;
}

export interface StrategyAccuracy {
  id: string;
  asset_id: string;
  signal_term: SignalTerm;
  lookback_days: number;
  win_rate_pct: number;
  avg_return_pct: number;
  total_signals_tested: number;
  calculated_at: string;
}

export type ExecutionMode = 'paper' | 'testnet_live' | 'coindcx_live' | 'fivepaisa_live';

export interface Trade {
  id: string;
  user_id: string;
  strategy_id: string | null;
  asset_id: string;
  signal_id: string | null;
  trade_type: TradeType;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: TradeStatus;
  is_paper_trade: boolean;
  opened_at: string | null;
  closed_at: string | null;
  rejected_at: string | null;
  pnl: number;
  execution_mode: ExecutionMode;
  broker_order_id: number | null;
  broker: string | null;
  broker_order_ref: string | null;
}

export interface PortfolioSnapshot {
  id: string;
  user_id: string;
  timestamp: string;
  total_value: number;
  cash_balance: number;
  unrealized_pnl: number;
}
