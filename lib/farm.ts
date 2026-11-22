// Farm plans: what a reader does to farm a pre-token protocol, in concrete steps with what each costs and
// how long it takes. Written only from the snapshot's own facts (chains, TVL, its 7-day change, how long
// it has been tracked, its sector) and general on-chain practice: no URL, no date and no figure that the
// snapshot does not carry is ever made up. A plan is a checklist, never advice to invest.

import type { SnapshotProtocol, Valuation } from './model.ts';

export interface FarmStep {
  /** what to do */
  do: string;
  /** what it costs */
  cost: string;
  /** how long it takes */
  time: string;
}

const usd = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

/** Gas tier of a chain in plain words: Ethereum mainnet and Bitcoin are the expensive ones; the rest are cheap. */
function gas(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum mainnet gas (the costliest tier)';
  if (chain === 'Bitcoin') return 'a Bitcoin on-chain fee (varies with mempool load)';
  return `${chain} gas (a low-fee chain)`;
}

/** The chain a plan starts on: a cheaper chain than Ethereum when the protocol lists one. */
function startChain(p: SnapshotProtocol): string {
  const cheap = p.chains.find((c) => c !== 'Ethereum' && c !== 'Bitcoin');
  return cheap ?? p.chains[0] ?? 'its home chain';
}

function share(p: SnapshotProtocol, amount: number): string {
  const pct = (amount / p.tvl_usd) * 100;
  // Two significant digits, never in exponent form: 0.000036% rather than 3.6e-5%.
  return `${pct.toFixed(Math.max(2, 1 - Math.floor(Math.log10(pct))))}%`;
}

/** The sector's core actions: how capital is put to work in that kind of protocol. */
function coreSteps(p: SnapshotProtocol, sector: string, chain: string): FarmStep[] {
  const g = gas(chain);
  switch (sector) {
    case 'Vaults & curation':
      return [
        { do: `Pick one ${p.name} vault on ${chain} whose deposit asset you already hold (a stablecoin or ETH-type asset). Read its strategy page: which markets it allocates to, its fee, and whether withdrawals are instant or queued.`, cost: 'free (reading)', time: '~15 min' },
        { do: `Deposit into that vault: approve the asset, then deposit. Start with a test amount, withdraw it once to confirm the exit path works, then deposit the size you chose.`, cost: `${g}: 2 transactions to enter, 1 to test the exit`, time: '~10 min' },
        { do: `Check the vault's allocation weekly: a curator moves deposits between markets, so the risk you hold changes without a transaction of yours.`, cost: 'free', time: '~5 min a week' },
      ];
    case 'Yield dollars':
      return [
        { do: `Get the stablecoin ${p.name} accepts for minting or depositing on ${chain} (check its docs for the list) and read how redemption works: instant, queued or with a cooldown.`, cost: `a swap fee if you must convert, plus ${g}`, time: '~15 min' },
        { do: `Mint or deposit into ${p.name}'s yield-bearing dollar with a test amount, redeem it back once, then deposit your chosen size and keep the receipt token in the same wallet.`, cost: `${g}: about 4 transactions (approve, mint, redeem test, mint)`, time: '~20 min' },
        { do: `If the app lists integrations (lending markets or liquidity pools that accept its dollar), use at most one of them, and only after reading that integration's own risk notes.`, cost: `${g} per integration step`, time: '~15 min' },
      ];
    case 'Lending & credit':
      return [
        { do: `Supply a major asset (a stablecoin or ETH-type asset) to ${p.name} on ${chain}. Supplying alone has no liquidation risk on your side; check the market's utilisation before you size it.`, cost: `${g}: approve + supply`, time: '~10 min' },
        { do: `Optionally borrow a small amount against it and keep the loan-to-value far below the liquidation threshold the app shows (a quarter of it is a cautious level). Many lending points schemes count both sides, but a borrow can be liquidated.`, cost: `${g}: 1 borrow; interest on the loan`, time: '~5 min, then a daily glance' },
        { do: `Set a price alert on your collateral, or skip borrowing entirely if you cannot watch it.`, cost: 'free', time: '~5 min' },
      ];
    case 'Trading':
      return [
        { do: `Fund ${p.name} on ${chain} with a small trading balance. If it is an exchange of pools, add liquidity to its deepest major pair instead of trading: fees accrue to you while you hold the position.`, cost: `${g}: deposit or add-liquidity transactions; impermanent loss on a pool`, time: '~15 min' },
        { do: `If you trade, keep leverage low (2x or less) and trade only pairs you would trade anyway: volume-based points rarely pay for fees and slippage on forced trades.`, cost: 'trading fees and slippage on each trade', time: 'a few trades a week' },
        { do: `Keep a fee log (date, size, fee) so you can compare what farming costs with anything it later earns.`, cost: 'free', time: '~5 min a week' },
      ];
    case 'Real-world assets':
      return [
        { do: `Check eligibility first: real-world-asset products often require identity checks (KYC), a jurisdiction list and a minimum ticket. Read ${p.name}'s terms before moving funds.`, cost: 'free; your identity documents if KYC applies', time: '~30 min, plus any review time' },
        { do: `Subscribe with a test amount on ${chain}, note the redemption schedule (daily, weekly or monthly windows are common), then subscribe your chosen size.`, cost: `${g}; any subscription fee the terms state`, time: '~20 min' },
        { do: `Diarise the next redemption window: capital in an RWA product can be slower to exit than a DeFi pool.`, cost: 'free', time: '~5 min' },
      ];
    case 'Staking & BTC':
      return [
        { do: `Stake or deposit the asset ${p.name} supports on ${chain}. Read the unbonding or withdrawal delay before you deposit: it is the time your capital is locked when you want out.`, cost: `${g}: approve + stake`, time: '~10 min, plus the unbonding delay to exit' },
        { do: `Keep the receipt it gives you in the same wallet; moving it elsewhere can drop you from any points tracking.`, cost: 'free', time: '~2 min' },
      ];
    case 'Chains & infra':
      return [
        { do: `Bridge a small balance to ${chain} through the official bridge its docs name, and keep enough of the native gas token for a few weeks of activity.`, cost: `bridge fee plus ${g}`, time: '~20 min (bridges can take longer to settle)' },
        { do: `Use ${p.name} for what it is built for (payments, transfers or the apps on it), spread over several weeks rather than in one burst: networks tend to look at sustained use, not a single day.`, cost: `${g} per transaction`, time: '~10 min a week' },
      ];
    default:
      return [
        { do: `Read ${p.name}'s documentation to find its core action (deposit, stake, trade or use), then do it once with a test amount on ${chain} and exit once to prove the way out.`, cost: `${g}: about 3 transactions`, time: '~20 min' },
        { do: `Repeat the core action with your chosen size and keep the position in one wallet.`, cost: `${g}`, time: '~10 min' },
      ];
  }
}

/** The whole plan, 7 to 9 steps, every one with a cost and a time. */
export function farmPlan(p: SnapshotProtocol, sector: string, v: Valuation, marketChange: number): FarmStep[] {
  const chain = startChain(p);
  const chainList = p.chains.length > 3 ? `${p.chains.slice(0, 3).join(', ')} and ${p.chains.length - 3} more` : p.chains.join(', ');
  const steps: FarmStep[] = [
    {
      do: `Find ${p.name}'s official app through its DefiLlama listing (slug ${p.slug}) and confirm the domain on the team's own announcement channel before connecting a wallet. Never follow links from replies or DMs.`,
      cost: 'free',
      time: '~10 min',
    },
    {
      do: `Use a dedicated wallet that holds only what you plan to deposit. ${p.name} is listed on ${chainList}; start on ${chain}${p.chains.length > 1 ? ' unless the product you want lives only elsewhere' : ''}.`,
      cost: p.chains.length > 1 ? `one transfer or bridge to ${chain} plus ${gas(chain)}` : `one transfer plus ${gas(chain)}`,
      time: '~10 min',
    },
    {
      do: `Size the position from the snapshot: TVL is ${usd(p.tvl_usd)}, so $1,000 is ${share(p, 1_000)} of the pool and $10,000 is ${share(p, 10_000)}. Choose an amount you can afford to lose entirely.`,
      cost: 'free (arithmetic)',
      time: '~5 min',
    },
    ...coreSteps(p, sector, chain),
    {
      do: `Log every deposit (date, amount, transaction hash) and check the app for a points or rewards page. Hold the position for weeks, not days: programs that reward deposits usually weight time as well as size.`,
      cost: `opportunity cost of the capital while it sits in ${p.name}`,
      time: '~5 min a week, for 4 weeks or more',
    },
    {
      do: `Set an exit rule now: its TVL moved ${p.change_7d === null ? 'by an unreported amount' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`} in the snapshot week against a market median of ${marketChange.toFixed(1)}%. Withdraw if TVL falls sharply in a week, the terms change, or an exploit is reported.`,
      cost: `${gas(chain)} for the withdrawal`,
      time: '~5 min',
    },
    {
      do: `If a token is ever announced, claim only through the official app, read every signature request, and decide your sell-or-hold rule before claiming. Nothing here says a token will launch.`,
      cost: `${gas(chain)} for the claim`,
      time: '~10 min',
    },
  ];
  // The runway line only where the snapshot dates the listing.
  if (v.runway_days !== null && v.runway_days < 120) {
    steps.splice(3, 0, {
      do: `Its DefiLlama record is ${v.runway_days} days old: young TVL can leave as fast as it came. Start smaller than you would on an older protocol and add only after a few weeks of stable TVL.`,
      cost: 'free',
      time: 'decide now; revisit in 2 to 4 weeks',
    });
  }
  return steps;
}

/** A step as the board's farm_steps string (20 to 600 characters once trimmed). */
export function stepText(s: FarmStep): string {
  return `${s.do} Cost: ${s.cost}. Time: ${s.time}.`.slice(0, 600).trim();
}
