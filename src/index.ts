// Download historical Data here on a per year timeframe https://coinmarketcap.com/de/currencies/solana/historical-data/
// Rename files to solprice2023.csv, solprice2023.csv etc.

import { address, createSolanaRpc } from "@solana/web3.js";
import * as fs from "fs";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Load environment variables
dotenv.config();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('wallet', {
    alias: 'w',
    type: 'string',
    description: 'Wallet address to analyze'
  })
  .option('rpc', {
    alias: 'r',
    type: 'string',
    description: 'RPC URL to use'
  })
  .option('yearly-sum', {
    alias: 'y',
    type: 'boolean',
    description: 'Calculate sum of balance changes for the past year'
  })
  .option('historical-sum', {
    alias: 'h',
    type: 'boolean',
    description: 'Calculate sum of balance changes older than one year'
  })
  .help()
  .parseSync();

// Get wallet and RPC URL from command line args or environment variables
const walletAddress = (argv.wallet as string) || process.env.WALLET_ADDRESS;
const rpcUrl = (argv.rpc as string) || process.env.RPC_URL;

if (!walletAddress || !rpcUrl) {
  console.error('Error: Wallet address and RPC URL must be provided either via command line arguments or .env file');
  process.exit(1);
}

const wallet = address(walletAddress);

//@ts-ignore
BigInt.prototype["toJSON"] = function () {
  return this.toString();
};

// Create output directory if it doesn't exist
if (!fs.existsSync("output")) {
  fs.mkdirSync("output");
}

const fetchSignatures = async () => {
  const rpc = createSolanaRpc(rpcUrl);
  const newSignatures = [];
  let hasMore = true;
  let before;
  let retryCount = 0;
  const maxRetries = 3;

  // Read existing signatures if file exists
  let existingSignatures: any[] = [];
  if (fs.existsSync("output/signatures.json")) {
    console.log("Reading existing signatures...");
    existingSignatures = JSON.parse(fs.readFileSync("output/signatures.json", "utf8"));
    console.log(`Found ${existingSignatures.length} existing signatures`);
  }

  // Create a Set of existing signatures for faster lookup
  const existingSignatureSet = new Set(
    existingSignatures.map((sig) => sig.signature)
  );

  while (hasMore) {
    try {
      //@ts-ignore
      const signatures = await rpc
        .getSignaturesForAddress(wallet, { limit: 1000, before })
        .send();

      console.log(`Fetched ${signatures.length} signatures`);
      retryCount = 0; // Reset retry count on successful fetch

      // Check if any of these signatures already exist
      //@ts-ignore
      const foundExisting = signatures.some((sig) =>
        existingSignatureSet.has(sig.signature)
      );
      if (foundExisting) {
        console.log("Found existing signature, stopping fetch");
        hasMore = false;
      }

      if (signatures.length < 1000) {
        hasMore = false;
      }

      if (signatures.length > 0) {
        before = signatures[signatures.length - 1].signature;
        newSignatures.push(...signatures);
      }

      // Sleep for 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Error fetching signatures:", error);
      retryCount++;
      if (retryCount >= maxRetries) {
        console.log(`Failed after ${maxRetries} retries, saving current progress...`);
        break;
      }
      console.log(`Retry ${retryCount}/${maxRetries} after 5 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  // Merge new and existing signatures, removing duplicates
  const allSignatures = [...newSignatures, ...existingSignatures];
  const uniqueSignatures = Array.from(
    new Map(allSignatures.map((sig) => [sig.signature, sig])).values()
  );

  // Sort signatures by blockTime in descending order (newest first)
  // Convert BigInt to string for comparison to avoid errors
  uniqueSignatures.sort((a, b) => {
    const aTime = Number(a.blockTime);
    const bTime = Number(b.blockTime);
    return bTime - aTime;
  });

  // Write to JSON file
  try {
    fs.writeFileSync(
      "output/signatures.json",
      JSON.stringify(uniqueSignatures, null, 2)
    );
    console.log(
      `Saved ${uniqueSignatures.length} unique signatures to output/signatures.json`
    );
    console.log(
      `Added ${
        uniqueSignatures.length - existingSignatures.length
      } new signatures`
    );
  } catch (error) {
    console.error("Error writing to file:", error);
  }
};
const fetchTransactions = async () => {
  const rpc = createSolanaRpc(rpcUrl);
  let i = 0;
  const errors = [];
  try {
    const signatures = JSON.parse(fs.readFileSync("output/signatures.json", "utf8"));

    // Create transactions directory if it doesn't exist
    if (!fs.existsSync("output/transactions")) {
      fs.mkdirSync("output/transactions");
    }

    // Get list of existing transaction files
    const existingTxFiles = fs.readdirSync("output/transactions")
      .map(file => file.replace('.json', ''));
    //@ts-ignore
    const missingSignatures = signatures.filter(sig => !existingTxFiles.has(sig.signature));

    console.log(`Found ${missingSignatures.length} transactions to fetch`);

    for (const sig of missingSignatures) {
      i = i + 1;
      const txFilePath = `output/transactions/${sig.signature}.json`;

      try {
        const tx = await rpc
          .getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
            encoding: "jsonParsed",
          })
          .send();

        // Save individual transaction to its own file
        fs.writeFileSync(txFilePath, JSON.stringify(tx));

        console.log(`Transaction ${i} of ${missingSignatures.length} fetched (${sig.signature})`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Error fetching transaction ${sig.signature}:`, error);
        errors.push(sig.signature);
        // Save errors each time a new one is added
        fs.writeFileSync("output/errors.json", JSON.stringify(errors, null, 2));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const txFiles = fs.readdirSync("output/transactions");
    console.log(
      `Total transactions in directory: ${txFiles.length}`
    );
    if (errors.length > 0) {
      console.log(`Failed to fetch ${errors.length} transactions`);
    }
  } catch (error) {
    console.error("Error reading signatures file:", error);
  }
};

const analyzeBalanceChanges = async () => {
  try {
    const txFiles = fs.readdirSync("output/transactions");
    const balanceChanges = [];
    const errorFiles = [];
    const noBalanceChangeTransactions = [];
    const transactionsWithErrors = [];
    let noBalanceChangeCount = 0;
    let notFoundInTxCount = 0;
    let i = 0;

    console.log(`Total transaction files: ${txFiles.length}`);

    // Helper function to format date for German Excel
    const formatDateForExcel = (timestamp: number) => {
      const date = new Date(timestamp * 1000);
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const seconds = date.getSeconds().toString().padStart(2, "0");
      return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    };

    for (const txFile of txFiles) {
      try {
        const tx = JSON.parse(
          fs.readFileSync(`output/transactions/${txFile}`, "utf8")
        );

        if (!tx) {
          errorFiles.push({ file: txFile, error: "Null transaction" });
          continue;
        }

        // Check for transaction errors first
        if (tx?.meta?.err) {
          transactionsWithErrors.push({
            signature: tx.transaction.signatures[0],
            blockTime: new Date(Number(tx.blockTime) * 1000).toLocaleString(
              "de-DE",
              { timeZone: "Europe/Berlin" }
            ),
            error: JSON.stringify(tx.meta.err),
            logMessages: tx.meta.logMessages || [],
          });
          continue; // Skip further processing for transactions with errors
        }

        if (tx?.meta?.postBalances && tx?.meta?.preBalances && tx.blockTime) {
          //@ts-ignore
          const allAddresses = tx.transaction.message.accountKeys.map((acc) =>
            typeof acc === "string" ? acc : acc.pubkey
          );
          const accountIndex = allAddresses.findIndex(
            //@ts-ignore
            (addr) => addr === wallet
          );

          if (accountIndex !== -1) {
            const preBalance = BigInt(tx.meta.preBalances[accountIndex]);
            const postBalance = BigInt(tx.meta.postBalances[accountIndex]);
            const balanceChange = postBalance - preBalance;

            if (balanceChange !== BigInt(0)) {
              let sender = "";
              for (let i = 0; i < allAddresses.length; i++) {
                const accountPreBalance = BigInt(tx.meta.preBalances[i]);
                const accountPostBalance = BigInt(tx.meta.postBalances[i]);
                if (accountPostBalance < accountPreBalance) {
                  sender = allAddresses[i];
                  break;
                }
              }

              balanceChanges.push({
                blockTime: formatDateForExcel(Number(tx.blockTime)),
                balanceChange: Number(balanceChange) / 1e9,
                sender,
                signature: tx.transaction.signatures[0],
              });
            } else {
              noBalanceChangeCount++;
              noBalanceChangeTransactions.push({
                signature: tx.transaction.signatures[0],
                blockTime: new Date(Number(tx.blockTime) * 1000).toLocaleString(
                  "de-DE",
                  { timeZone: "Europe/Berlin" }
                ),
                preBalance: Number(preBalance) / 1e9,
                postBalance: Number(postBalance) / 1e9,
                logMessages: tx.meta.logMessages || [],
              });
            }
          } else {
            notFoundInTxCount++;
          }
        } else {
          errorFiles.push({
            file: txFile,
            error:
              "Missing required transaction data (postBalances, preBalances, or blockTime)",
          });
        }
      } catch (error) {
        console.error(`Error processing file ${txFile}:`, error);
        errorFiles.push({
          file: txFile,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        continue;
      }
    }

    // Write transactions with errors to file
    if (transactionsWithErrors.length > 0) {
      fs.writeFileSync(
        "output/transactions_with_errors.json",
        JSON.stringify(transactionsWithErrors, null, 2)
      );
      console.log(
        `Saved ${transactionsWithErrors.length} transactions with errors to output/transactions_with_errors.json`
      );
    }

    // Write no balance change transactions to file
    if (noBalanceChangeTransactions.length > 0) {
      fs.writeFileSync(
        "output/no_balance_changes.json",
        JSON.stringify(noBalanceChangeTransactions, null, 2)
      );
      console.log(
        `Saved ${noBalanceChangeTransactions.length} no-balance-change transactions to output/no_balance_changes.json`
      );
    }

    console.log(`
Transaction Summary:
Total files: ${txFiles.length}
Balance changes found: ${balanceChanges.length}
Transactions with no balance change: ${noBalanceChangeCount}
Transactions with errors: ${transactionsWithErrors.length}
Wallet not found in transactions: ${notFoundInTxCount}
Parse errors: ${errorFiles.length}
Total accounted for: ${
      balanceChanges.length +
      noBalanceChangeCount +
      notFoundInTxCount +
      errorFiles.length
    }
    `);

    // Helper function to parse price data from CSV
    const loadPriceData = (year: number) => {
      try {
        const priceFile = fs.readFileSync(`solprice/${year}.csv`, 'utf8');
        const lines = priceFile.split('\n').slice(1); // Skip header
        const prices = new Map<string, number>();
        
        lines.forEach(line => {
          if (!line.trim()) return;
          const columns = line.split(';');
          const date = columns[0];
          const low = columns[5];
          
          // Convert date from "YYYY-MM-DDT00:00:00.000Z" to "DD.MM.YYYY"
          const [yyyy, mm, dd] = date.substring(1, 11).split('-');
          const dateKey = `${dd}.${mm}.${yyyy}`;
          
          // Remove quotes and convert German number format to standard
          const cleanLow = low.replace(/"/g, '').replace(',', '.');
          const lowPrice = parseFloat(cleanLow);
          
          if (!isNaN(lowPrice)) {
            prices.set(dateKey, lowPrice);
          } else {
            console.error(`Invalid price for ${dateKey}: ${low}`);
          }
        });
        
        console.log(`Loaded ${prices.size} prices for ${year}`);
        // Debug: show first few prices with raw values
        const firstPrices = Array.from(prices.entries()).slice(0, 3);
        console.log(`Sample prices for ${year}:`);
        firstPrices.forEach(([date, price]) => {
          const rawLine = lines.find(l => l.includes(date.split('.').reverse().join('-')));
          console.log(`  ${date} -> ${price} (raw: ${rawLine?.split(';')[5]})`);
        });
        
        return prices;
      } catch (error) {
        console.error(`Error loading price data for ${year}:`, error);
        return new Map();
      }
    };

    // Group balance changes by year
    const balanceChangesByYear = new Map<number, typeof balanceChanges>();
    
    balanceChanges.forEach((change) => {
      const year = parseInt(change.blockTime.split('.')[2].substring(0, 4));
      if (!balanceChangesByYear.has(year)) {
        balanceChangesByYear.set(year, []);
      }
      balanceChangesByYear.get(year)?.push(change);
    });

    // Write separate CSV files for each year
    for (const [year, changes] of balanceChangesByYear) {
      const priceData = loadPriceData(year);
      const csvContent = ["Datum;BalanceChange;Sender;Signature;SolPrice;EurValue\n"];
      
      changes.forEach(({ blockTime, balanceChange, sender, signature }) => {
        // Extract date part without time for price lookup
        const dateKey = blockTime.split(' ')[0];
        const solPrice = priceData.get(dateKey) || 0;
        const eurValue = balanceChange * solPrice;
        
        const formattedBalance = balanceChange.toString().replace(".", ",");
        const formattedPrice = solPrice.toString().replace(".", ",");
        const formattedEurValue = eurValue.toString().replace(".", ",");
        
        csvContent.push(
          `"${blockTime}";"${formattedBalance}";"${sender}";"${signature}";"${formattedPrice}";"${formattedEurValue}"\n`
        );
      });

      const filename = `output/balance_changes_${year}.csv`;
      fs.writeFileSync(filename, csvContent.join(""));
      console.log(
        `Saved ${changes.length} balance changes for ${year} to ${filename}`
      );
    }

    console.log(
      `Total balance changes split into ${balanceChangesByYear.size} years`
    );

    if (errorFiles.length > 0) {
      fs.writeFileSync(
        "output/analyze_errors.json",
        JSON.stringify(errorFiles, null, 2)
      );
      console.log(`Saved ${errorFiles.length} errors to output/analyze_errors.json`);
    } else {
      console.log("No errors found.");
    }
  } catch (error) {
    console.error("Error analyzing balance changes:", error);
  }
};

const calculateYearlySum = async () => {
  try {
    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    
    let totalBalance = 0;
    let totalEurValue = 0;
    let transactionCount = 0;
    
    // Get all CSV files in output directory
    const files = fs.readdirSync('output')
      .filter(file => file.startsWith('balance_changes_') && file.endsWith('.csv'));
    
    for (const file of files) {
      const content = fs.readFileSync(`output/${file}`, 'utf8');
      const lines = content.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [dateStr, balanceChange, , , , eurValue] = line.split(';').map(s => s.replace(/"/g, ''));
        const [day, month, year] = dateStr.split(' ')[0].split('.');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        
        // Convert string numbers with German format to float
        const balanceChangeNum = parseFloat(balanceChange.replace(',', '.'));
        const eurValueNum = parseFloat(eurValue.replace(',', '.'));
        
        // Only consider positive balance changes (incoming transactions)
        if (date >= oneYearAgo && date <= now && balanceChangeNum > 0) {
          totalBalance += balanceChangeNum;
          totalEurValue += eurValueNum;
          transactionCount++;
        }
      }
    }
    
    console.log('\nIncoming balance changes for the past year:');
    console.log(`Number of incoming transactions: ${transactionCount}`);
    console.log(`Total incoming SOL: ${totalBalance.toFixed(4)}`);
    console.log(`Total incoming EUR value: ${totalEurValue.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error calculating yearly sum:', error);
  }
};

const calculateHistoricalSum = async () => {
  try {
    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    
    // Set time to start of day to ensure consistent comparison
    oneYearAgo.setHours(0, 0, 0, 0);
    
    let totalBalance = 0;
    let totalEurValue = 0;
    let oldestDate: Date | null = null;
    let transactionCount = 0;
    
    // Get all CSV files in output directory
    const files = fs.readdirSync('output')
      .filter(file => file.startsWith('balance_changes_') && file.endsWith('.csv'));
    
    for (const file of files) {
      const content = fs.readFileSync(`output/${file}`, 'utf8');
      const lines = content.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [dateStr, balanceChange, , , , eurValue] = line.split(';').map(s => s.replace(/"/g, ''));
        const [day, month, year] = dateStr.split(' ')[0].split('.');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        // Set time to start of day to ensure consistent comparison
        date.setHours(0, 0, 0, 0);
        
        // Convert string numbers with German format to float
        const balanceChangeNum = parseFloat(balanceChange.replace(',', '.'));
        const eurValueNum = parseFloat(eurValue.replace(',', '.'));
        
        // Only consider positive balance changes (incoming transactions)
        // Using strict less than to exclude the cutoff date
        if (date < oneYearAgo && balanceChangeNum > 0) {
          totalBalance += balanceChangeNum;
          totalEurValue += eurValueNum;
          transactionCount++;
          
          if (!oldestDate || date < oldestDate) {
            oldestDate = date;
          }
        }
      }
    }
    
    // Get the day before oneYearAgo for the end date of the period
    const periodEndDate = new Date(oneYearAgo);
    periodEndDate.setDate(periodEndDate.getDate() - 1);
    
    console.log('\nHistorical incoming balance changes (older than one year):');
    console.log(`Period: ${oldestDate?.toLocaleDateString('de-DE')} to ${periodEndDate.toLocaleDateString('de-DE')}`);
    console.log(`Number of incoming transactions: ${transactionCount}`);
    console.log(`Total incoming SOL: ${totalBalance.toFixed(4)}`);
    console.log(`Total incoming EUR value: ${totalEurValue.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error calculating historical sum:', error);
  }
};

(async () => {
  if (argv.yearlySum) {
    await calculateYearlySum();
    return;
  }

  if (argv.historicalSum) {
    await calculateHistoricalSum();
    return;
  }

  await fetchSignatures();

  const signatures = JSON.parse(fs.readFileSync("output/signatures.json", "utf8"));
  console.log(`Total signatures: ${signatures.length}`);

  // Create transactions directory if it doesn't exist
  if (!fs.existsSync("output/transactions")) {
    fs.mkdirSync("output/transactions");
  }

  // Check if we need to fetch any missing transactions
  const existingTxFiles = fs.readdirSync("output/transactions")
    .map(file => file.replace('.json', ''));
  console.log(`Existing transaction files: ${existingTxFiles.length}`);

  if (existingTxFiles.length < signatures.length) {
    console.log(`Missing ${signatures.length - existingTxFiles.length} transactions. Fetching...`);
    await fetchTransactions();
  }

  console.log("Analyzing balance changes...");
  await analyzeBalanceChanges();
})();