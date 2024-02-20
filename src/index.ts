import { add, eachMonthOfInterval } from 'date-fns';
import {
  Account,
  AccountInfo,
  AccountTree,
  addAccountTableEntryToAccountTree,
  findAccountInAccountTree,
  preOrderTraversalReduce,
} from './Account';
import { RawEntry, Entry, processRawEntries } from './Entry';
import { Currency } from './Currency';

const nonEmptyCellFilter = (cell: string): boolean => cell !== '';
const nonEmptyRowFilter = (row: string[]): boolean => row[0] !== '';

type Period = {
  begin: Date;
  end: Date;
};

const makeMonthlyAccountingPeriods = (ledger: Entry[]): Period[] =>
  eachMonthOfInterval({
    start: ledger[0].date,
    end: add(ledger[ledger.length - 1].date, { months: 1 }),
  }).map((firstDate) => ({
    begin: firstDate,
    end: add(firstDate, { months: 1 }),
  }));

const makeCurrencies = (currenciesTable: string[][]): Currency[] =>
  currenciesTable.filter(nonEmptyRowFilter).map((row) => row[0]);

function makeAccountTree(accountTable: SheetsTable, accountTypes: SheetsTable): AccountTree {
  const accountTree: AccountTree = {
    rootAccounts: [],
  };
  for (const [rootAccName, accountNormality, isPartOfNetRevenue] of accountTypes.filter(
    nonEmptyRowFilter,
  )) {
    const kind: 'normalCredit' | 'normalDebit' =
      accountNormality === 'Credit' ? 'normalCredit' : 'normalDebit';
    const statement: 'balanceSheet' | 'incomeStatement' =
      isPartOfNetRevenue === 'Yes' ? 'incomeStatement' : 'balanceSheet';
    accountTree.rootAccounts.push({
      name: rootAccName,
      info: { kind: kind, statement: statement },
      children: [],
    });
  }
  for (const accountTableEntry of accountTable.filter(nonEmptyRowFilter)) {
    addAccountTableEntryToAccountTree(accountTree, accountTableEntry.filter(nonEmptyCellFilter));
  }
  return accountTree;
}

function parseLedgerTablesFromSheets(
  accountTree: AccountTree,
  ledgerTables: string[][][],
): RawEntry[] {
  const ledger: RawEntry[] = [];
  for (const ledgerTable of ledgerTables) {
    const ledgerTableEntries = ledgerTable.filter(nonEmptyRowFilter).values();
    const header = ledgerTableEntries.next();
    if (header.done === false) {
      const [, ledgerType, , currency] = header.value;
      ledgerTableEntries.next();
      if (ledgerType === 'General Ledger') {
        for (const entry of ledgerTableEntries) {
          const [date, description, debitAccountName, creditAccountName, value] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          if (debitAccount !== null && creditAccount !== null) {
            const ledgerEntry: RawEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'default',
                debitAccount,
                creditAccount,
                currency,
                value: +value,
              },
            };
            ledger.push(ledgerEntry);
          }
        }
      } else if (ledgerType === 'Liability Ledger') {
        for (const entry of ledgerTableEntries) {
          const [date, description, debitAccountName, creditAccountName, value, term] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          if (debitAccount !== null && creditAccount !== null) {
            const ledgerEntry: RawEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'liability',
                debitAccount,
                creditAccount,
                currency,
                value: +value,
                paymentTerm: new Date(term),
              },
            };
            ledger.push(ledgerEntry);
          }
        }
      } else if (ledgerType === 'Exchange Ledger') {
        for (const entry of ledgerTableEntries) {
          const [
            date,
            description,
            debitAccountName,
            creditAccountName,
            exchangeAccountName,
            debitCurrency,
            debitValue,
            creditCurrency,
            creditValue,
          ] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          const exchangeAccount = findAccountInAccountTree(accountTree, exchangeAccountName);
          if (debitAccount !== null && creditAccount !== null && exchangeAccount !== null) {
            const ledgerEntry: RawEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'exchange',
                debitAccount,
                creditAccount,
                exchangeAccount,
                debitCurrency,
                debitValue: +debitValue,
                creditCurrency,
                creditValue: +creditValue,
              },
            };
            ledger.push(ledgerEntry);
          }
        }
      }
    }
  }
  ledger.sort((a, b) => (a.date < b.date ? -1 : 1));
  return ledger;
}

type AccountMonthlyLedger = {
  currency: string;
  period: Period;
  account: Account;
  accountType: AccountInfo;
  entries: Entry[];
  subaccountEntries: Entry[];
};

// function makeAccountMonthlyLedgers(
//   accountTree: AccountTree,
//   ledger: Entry[],
//   currencies: Currency[],
// ): AccountMonthlyLedger[] {
//   const ledgerByDate = ledger.map((entry) => {
//     const period = { month: entry.date.getMonth(), year: entry.date.getFullYear() };
//     return { period, entry };
//   });
//   const ledgerByDateAndAccount = ledgerByDate.flatMap(({ period, entry }) => {
//     const kind = entry.data.kind;
//     if (kind === 'default' || kind === 'liability') {
//       const creditEntry: Entry = {
//         account: entry.data.creditAccount,
//         type: 'credit',
//         currency: entry.data.currency,
//         value: entry.data.value,
//       };
//       const debitEntry: Entry = {
//         account: entry.data.debitAccount,
//         type: 'debit',
//         currency: entry.data.currency,
//         value: entry.data.value,
//       };
//       const credit = { period, originalEntry: entry, accountEntry: creditEntry };
//       const debit = { period, originalEntry: entry, accountEntry: debitEntry };
//       return [credit, debit];
//     } else if (kind === 'exchange') {
//       const creditEntry: Entry = {
//         account: entry.data.creditAccount,
//         type: 'credit',
//         currency: entry.data.creditCurrency,
//         value: entry.data.creditValue,
//       };
//       const debitEntry: Entry = {
//         account: entry.data.debitAccount,
//         type: 'debit',
//         currency: entry.data.debitCurrency,
//         value: entry.data.debitValue,
//       };
//       const exchangeDebitEntry: Entry = {
//         account: entry.data.exchangeAccount,
//         type: 'debit',
//         currency: entry.data.creditCurrency,
//         value: entry.data.creditValue,
//       };
//       const exchangeCreditEntry: Entry = {
//         account: entry.data.exchangeAccount,
//         type: 'credit',
//         currency: entry.data.debitCurrency,
//         value: entry.data.debitValue,
//       };
//       const credit = { period, originalEntry: entry, accountEntry: creditEntry };
//       const debit = { period, originalEntry: entry, accountEntry: debitEntry };
//       const exchangeCredit = {
//         period,
//         originalEntry: entry,
//         accountEntry: exchangeCreditEntry,
//       };
//       const exchangeDebit = { period, originalEntry: entry, accountEntry: exchangeDebitEntry };
//       return [credit, debit, exchangeCredit, exchangeDebit];
//     }
//     return [];
//   });
//   const months = makeMonthlyAccountingPeriods(ledger);
//   const transactionsByCurrencyAndAccount = currencies.flatMap((currency) =>
//     accountTree.rootAccounts.flatMap(([rootAccount, accountType]) =>
//       preOrderTraversalReduce<AccountMonthlyLedger[]>(rootAccount, [], (account, accumulate) => {
//         return [
//           ...accumulate,
//           ...months.map(({ month, year }) => {
//             const entries = ledgerByDateAndAccount.filter(({ period, accountEntry }) => {
//               return (
//                 period.month === month &&
//                 period.year === year &&
//                 accountEntry.currency === currency &&
//                 accountEntry.account === account
//               );
//             });
//             const subaccountEntries = ledgerByDateAndAccount.filter(({ period, accountEntry }) => {
//               return (
//                 period.month === month &&
//                 period.year === year &&
//                 accountEntry.currency === currency &&
//                 isSubaccount(account, accountEntry.account)
//               );
//             });
//             return {
//               currency,
//               period: { month, year },
//               account,
//               accountType,
//               entries,
//               subaccountEntries,
//             };
//           }),
//         ];
//       }),
//     ),
//   );
//   return transactionsByCurrencyAndAccount;
// }

type SheetsReturnType = String | Date | number;
type SheetsTable = string[][];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyIncomeStatement(
  accountTypes: SheetsTable,
  accountTable: SheetsTable,
  currenciesTable: SheetsTable,
  ...ledgerTables: SheetsTable[]
): SheetsReturnType[][] {
  const currencies = makeCurrencies(currenciesTable);
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const rawEntries = parseLedgerTablesFromSheets(accountTree, ledgerTables);
  const entries = processRawEntries(rawEntries);
  //   use date libraries, and/or list manipulation ones(groupBy)

  // preOrderTraversalReduce()
  // entries.filter((entry) => {
  //   return true;
  // });
  //   TBH this should be just an inline filter/groupBy, no function created
  //   groupBy currency, account and MONTH .groupBy(x => x.currency).map(x => x.groupBy(y => y.date.getMonth()))

  // const stuff = Object.entries(Object.groupBy(entries, ({ account }) => account.name)).flatMap(
  //   ([accountName, value]) =>
  //     Object.entries(Object.groupBy(value!, (item) => item.currency)).flatMap(
  //       ([currencyName, entries]) =>
  //         entries?.map((item) => ({ ...item, currencyName, accountName })),
  //     ),
  // );
  // TBH this should be just an inline filter/groupBy, no function created
  // groupBy currency, account and MONTH .groupBy(x => x.currency).map(x => x.groupBy(y => y.date.getMonth()))
  // const transactionsByCurrencyAndAccount = makeAccountMonthlyLedgers(
  //   accountTree,
  //   ledger,
  //   currencies,
  // );

  // const transactionsByCurrencyAndAccount = makeAccountMonthlyLedgers(
  //   accountTree,
  //   ledger,
  //   currencies,
  // );

  // const revenue_account = findAccountInAccountTree(accountTree, 'revenue')!;
  // const exchange_account = findAccountInAccountTree(accountTree, 'exchange')!;
  // const expenses_account = findAccountInAccountTree(accountTree, 'expenses')!;
  // const incomeStatementAccounts = [revenue_account, exchange_account, expenses_account];

  const months = makeMonthlyAccountingPeriods(entries).reverse();

  const ret: SheetsReturnType[][] = months.map(({ begin, end }) => [begin, end]);
  // type AccountMonthlyLedgerWithTotals = AccountMonthlyLedger & {
  //   entriesTotal: number;
  //   subaccountEntriesTotal: number;
  // };
  // const incomeStatementTotals = incomeStatementAccounts.flatMap((parentAccount) =>
  //   preOrderTraversalReduce<AccountMonthlyLedgerWithTotals[]>(
  //     parentAccount,
  //     [],
  //     (account, accumulate) => {
  //       const totals = months.flatMap(({ month, year }) => {
  //         return currencies.flatMap((currency) => {
  //           const [filteredEntry] = transactionsByCurrencyAndAccount.filter(
  //             ({ period, account: entryAccount, currency: entryCurrency }) =>
  //               month === period.month &&
  //               year === period.year &&
  //               currency === entryCurrency &&
  //               account === entryAccount,
  //           );
  //           const reduceEntriesTotal = (total: number, entry: LedgerAndAccountEntry) => {
  //             if (filteredEntry.accountType.kind === 'normalCredit') {
  //               if (entry.accountEntry.type === 'credit') {
  //                 return total + entry.accountEntry.value;
  //               } else {
  //                 return total - entry.accountEntry.value;
  //               }
  //             } else {
  //               if (entry.accountEntry.type === 'debit') {
  //                 return total + entry.accountEntry.value;
  //               } else {
  //                 return total - entry.accountEntry.value;
  //               }
  //             }
  //           };
  //           const entriesTotal = filteredEntry.entries.reduce(reduceEntriesTotal, 0);
  //           const subaccountEntriesTotal = filteredEntry.subaccountEntries.reduce(
  //             reduceEntriesTotal,
  //             0,
  //           );
  //           return {
  //             ...filteredEntry,
  //             entriesTotal,
  //             subaccountEntriesTotal,
  //           } as AccountMonthlyLedgerWithTotals;
  //         });
  //       });
  //       return [...accumulate, ...totals];
  //     },
  //   ),
  // );

  // const currenciesHeader: SheetsReturnType[] = [''];
  // const monthsHeader: SheetsReturnType[] = [''];
  // for (const { month, year } of months) {
  //   for (const currency of currencies) {
  //     currenciesHeader.push(currency);
  //     monthsHeader.push(new Date(year, month));
  //   }
  // }

  // type NetRevenueEntry = {
  //   currency: string;
  //   period: Period;
  //   netRevenue: number;
  // };
  // const netRevenue: NetRevenueEntry[] = currencies.flatMap((currency) =>
  //   months.flatMap((period) => {
  //     const [revenueEntry] = incomeStatementTotals.filter(
  //       ({ period: entryPeriod, account: entryAccount, currency: entryCurrency }) =>
  //         period.month === entryPeriod.month &&
  //         period.year === entryPeriod.year &&
  //         currency === entryCurrency &&
  //         revenue_account === entryAccount,
  //     );
  //     const [exchangeEntry] = incomeStatementTotals.filter(
  //       ({ period: entryPeriod, account: entryAccount, currency: entryCurrency }) =>
  //         period.month === entryPeriod.month &&
  //         period.year === entryPeriod.year &&
  //         currency === entryCurrency &&
  //         exchange_account === entryAccount,
  //     );
  //     const [expensesEntry] = incomeStatementTotals.filter(
  //       ({ period: entryPeriod, account: entryAccount, currency: entryCurrency }) =>
  //         period.month === entryPeriod.month &&
  //         period.year === entryPeriod.year &&
  //         currency === entryCurrency &&
  //         expenses_account === entryAccount,
  //     );
  //     return {
  //       currency,
  //       period,
  //       netRevenue:
  //         revenueEntry.entriesTotal +
  //         revenueEntry.subaccountEntriesTotal +
  //         (exchangeEntry.entriesTotal + exchangeEntry.subaccountEntriesTotal) -
  //         (expensesEntry.entriesTotal + expensesEntry.subaccountEntriesTotal),
  //     };
  //   }),
  // );

  // const netIncomeHeader: number[][] = [[], [], [], []];
  // for (const [index, account] of incomeStatementAccounts.entries()) {
  //   for (const { month, year } of months) {
  //     for (const currency of currencies) {
  //       const [filteredEntry] = incomeStatementTotals.filter(
  //         ({ period, account: entryAccount, currency: entryCurrency }) =>
  //           month === period.month &&
  //           year === period.year &&
  //           currency === entryCurrency &&
  //           account === entryAccount,
  //       );
  //       netIncomeHeader[index].push(
  //         filteredEntry.entriesTotal + filteredEntry.subaccountEntriesTotal,
  //       );
  //     }
  //   }
  // }
  // for (const [index] of netIncomeHeader[0].entries()) {
  //   netIncomeHeader[3].push(
  //     (netIncomeHeader[0][index] as number) +
  //       (netIncomeHeader[1][index] as number) -
  //       (netIncomeHeader[2][index] as number),
  //   );
  // }
  // ret.push(currenciesHeader);
  // ret.push(monthsHeader);
  // ret.push(['Total Revenue', ...netIncomeHeader[0]]);
  // ret.push(['Total Exchange', ...netIncomeHeader[1]]);
  // ret.push(['Total Expenses', ...netIncomeHeader[2]]);
  // ret.push(['Net Revenue', ...netIncomeHeader[3]]);
  // for (const account of incomeStatementAccounts) {
  //   preOrderTraversalMap<string>(
  //     account,
  //     '',
  //     (account, prefix) => {
  //       const table_entry: SheetsReturnType[] = [];
  //       table_entry.push(prefix + account.name);
  //       for (const { month, year } of months) {
  //         for (const currency of currencies) {
  //           const [filteredEntry] = incomeStatementTotals.filter(
  //             ({ period, account: entryAccount, currency: entryCurrency }) =>
  //               month === period.month &&
  //               year === period.year &&
  //               currency === entryCurrency &&
  //               account === entryAccount,
  //           );
  //           table_entry.push(filteredEntry.entriesTotal);
  //         }
  //       }
  //       ret.push(table_entry);
  //       return prefix + '\t\t\t\t';
  //     },
  //     (account, prefix) => {
  //       if (account.children.length !== 0) {
  //         const table_entry: SheetsReturnType[] = [];
  //         table_entry.push(prefix.replace('\t\t\t\t', '') + 'TOTAL: ' + account.name);
  //         for (const { month, year } of months) {
  //           for (const currency of currencies) {
  //             const [filteredEntry] = incomeStatementTotals.filter(
  //               ({ period, account: entryAccount, currency: entryCurrency }) =>
  //                 month === period.month &&
  //                 year === period.year &&
  //                 currency === entryCurrency &&
  //                 account === entryAccount,
  //             );
  //             table_entry.push(filteredEntry.entriesTotal + filteredEntry.subaccountEntriesTotal);
  //           }
  //         }
  //         ret.push(table_entry);
  //       }
  //       return prefix.replace('\t\t\t\t', '');
  //     },
  //   );
  // }

  return ret;
}
