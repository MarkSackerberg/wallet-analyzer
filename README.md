# Solana Wallet Transaction Analyzer

This tool analyzes Solana wallet transactions, fetches historical data, and generates CSV reports with balance changes including SOL price data for tax reporting purposes.

## Features

- Fetches all transaction signatures for a wallet
- Downloads detailed transaction data
- Analyzes balance changes
- Generates yearly CSV reports with SOL prices and EUR values
- Handles transaction errors and edge cases
- Supports command line parameters and environment variables

## Installation

1. Clone the repository
2. Install dependencies:
```
pnpm install
```
3. Set up your environment variables. Copy and edit the new .env file.
```
cp .env.example .env
```
4. Run the script:
```
pnpm run dev
```


## Configuration

### Environment Variables

Create a `.env` file with the following variables:

- `WALLET_ADDRESS`: Your Solana wallet address
- `RPC_URL`: URL of your Solana RPC provider (e.g., from QuickNode, Alchemy, etc.)

### Command Line Parameters

Instead of using environment variables, you can also use command line parameters:

- `--wallet` or `-w`: Your Solana wallet address
- `--rpc` or `-r`: URL of your Solana RPC provider (e.g., from Metaplex Aura, QuickNode, etc.)
- `--yearly-sum` or `-y`: Calculate sum of balance changes for the past year
- `--historical-sum` or `-h`: Calculate sum of balance changes older than one year

## Price Data

The tool requires historical SOL price data to calculate EUR values. To update price data:

1. Visit [CoinMarketCap Historical Data](https://coinmarketcap.com/currencies/solana/historical-data/)
2. Download yearly CSV files
3. Place them in a `solprice` directory with the following naming convention:
   - `solprice/2024.csv`
   - `solprice/2023.csv`
   - etc.

Note: Make sure the CSV files use semicolon (;) as separator and German number format (comma for decimals).

## Output Files

The tool generates several output files in the `output` directory:

- `signatures.json`: All transaction signatures
- `transactions/*.json`: Individual transaction data
- `balance_changes_YYYY.csv`: Yearly reports with balance changes and prices
- `transactions_with_errors.json`: Failed transactions
- `no_balance_changes.json`: Transactions without balance changes
- `analyze_errors.json`: Analysis errors

### CSV Format

The yearly CSV files contain:
- Date and time
- Balance change in SOL
- Sender address
- Transaction signature
- SOL price
- EUR value

## Running the Tool
Using pnpm
```
pnpm run dev
```
With direct parameters
```
pnpm run dev --wallet <address> --rpc <url>
```
Calculate yearly sum
```
pnpm run dev --yearly-sum
```
Calculate historical sum
```
pnpm run dev --historical-sum
```
## Error Handling

The tool includes several error handling mechanisms:
- Retries for failed signature fetches
- Separate logging for transaction errors
- Tracking of transactions without balance changes
- Progress saving for interrupted runs

## Requirements

- Node.js 16 or higher
- PNPM
- Internet connection for RPC access
- RPC with historical data
- Historical price data CSV files

## Contact

For questions or feedback, please contact me on [X](https://x.com/MarkSackerberg) or discord.